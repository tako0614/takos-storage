import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  runPostDeploySmoke,
  type StorageSmokeOptions,
} from "./post-deploy-smoke.ts";
import { createStorageWorker } from "../src/worker.ts";
import type {
  Env,
  R2Bucket,
  R2Object,
  R2ObjectBody,
  R2PutOptions,
  R2ListOptions,
} from "../src/types.ts";

class Bucket implements R2Bucket {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; options?: R2PutOptions }
  >();
  async head(key: string): Promise<R2Object | null> {
    const x = this.objects.get(key);
    if (!x) return null;
    return {
      key,
      size: x.bytes.length,
      uploaded: new Date(0),
      httpEtag: `"${createHash("md5").update(x.bytes).digest("hex")}"`,
      httpMetadata: x.options?.httpMetadata,
      customMetadata: x.options?.customMetadata,
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const x = this.objects.get(key);
    if (!x) return null;
    return {
      key,
      size: x.bytes.length,
      uploaded: new Date(0),
      httpEtag: `"${createHash("md5").update(x.bytes).digest("hex")}"`,
      httpMetadata: x.options?.httpMetadata,
      customMetadata: x.options?.customMetadata,
      body: new Response(x.bytes.slice()).body!,
      arrayBuffer: async () => x.bytes.slice().buffer,
    };
  }
  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ) {
    const current = await this.head(key),
      condition = options?.onlyIf;
    const match =
      condition instanceof Headers
        ? condition.get("if-match")
        : condition?.etagMatches === undefined
          ? undefined
          : `"${condition.etagMatches}"`;
    const none =
      condition instanceof Headers
        ? condition.get("if-none-match")
        : condition?.etagDoesNotMatch;
    if (
      (match != null && current?.httpEtag !== match) ||
      (none === "*" && current)
    )
      return null;
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, options });
    return this.head(key);
  }
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys])
      this.objects.delete(key);
  }
  async list(options: R2ListOptions = {}) {
    const objects = await Promise.all(
      [...this.objects.keys()]
        .filter((key) => key.startsWith(options.prefix ?? ""))
        .map(async (key) => (await this.head(key))!),
    );
    return { objects, truncated: false };
  }
}

function fixture() {
  const bucket = new Bucket(),
    calls: Request[] = [];
  const tokens = {
    read: "taksrv_smoke_read",
    write: "taksrv_smoke_write",
    list: "taksrv_smoke_list",
    delete: "taksrv_smoke_delete",
  };
  const permissions = new Map(
    Object.entries(tokens).map(([operation, token]) => [
      token,
      `storage.object.${operation}`,
    ]),
  );
  const worker = createStorageWorker(async (_input, init) => {
    const token =
      new Headers(init?.headers)
        .get("authorization")
        ?.replace(/^Bearer /u, "") ?? "";
    const permission = permissions.get(token);
    if (!permission) return Response.json({}, { status: 401 });
    return Response.json({
      token_use: "interface_oauth",
      sub: "principal_smoke",
      aud: "https://storage.example/o",
      scope: permission,
      takosumi: {
        capsule_id: "capsule_smoke",
        interface_id: "interface_smoke",
        interface_binding_id: "binding_smoke",
        interface_resolved_revision: 1,
      },
    });
  });
  const env: Env = {
    BUCKET: bucket,
    APP_URL: "https://storage.example",
    OIDC_ISSUER_URL: "https://accounts.example",
    APP_CAPSULE_ID: "capsule_smoke",
  };
  const send = (request: Request) => worker.fetch(request, env);
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    return send(request);
  };
  const options: StorageSmokeOptions = {
    baseUrl: "https://storage.example",
    interfaceTokens: tokens,
    prefix: "smoke-test/",
  };
  return { bucket, calls, tokens, send, fetchImpl, options };
}

describe("post-deploy smoke source with synthetic local Worker", () => {
  test("uses create-only and the read ETag, then verifies actual cleanup", async () => {
    const f = fixture();
    const report = await runPostDeploySmoke(f.options, f.fetchImpl);
    expect(report.ok).toBe(true);
    expect(report.checks.length).toBe(8);
    expect(f.bucket.objects.size).toBe(0);
    expect(
      f.calls.find((x) => x.method === "PUT")?.headers.get("if-none-match"),
    ).toBe("*");
    expect(
      f.calls.find((x) => x.method === "DELETE")?.headers.get("if-match"),
    ).toMatch(/^"[a-f0-9]+"$/u);
  });

  test("preserves a writer that updates between the read and cleanup", async () => {
    const f = fixture();
    let etag: string | null = null;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.method === "DELETE") {
        const update = await f.send(
          new Request(request.url, {
            method: "PUT",
            headers: {
              authorization: `Bearer ${f.tokens.write}`,
              "if-match": etag!,
              "content-type": "text/plain",
            },
            body: "other writer",
          }),
        );
        expect(update.status).toBe(201);
      }
      const response = await f.fetchImpl(input, init);
      if (
        request.method === "GET" &&
        new URL(request.url).pathname.startsWith("/o/")
      )
        etag = response.headers.get("etag");
      return response;
    };
    await expect(runPostDeploySmoke(f.options, fetchImpl)).rejects.toThrow(
      "failed: 412",
    );
    const url = f.calls.find((x) => x.method === "DELETE")!.url;
    const current = await f.send(
      new Request(url, {
        headers: { authorization: `Bearer ${f.tokens.read}` },
      }),
    );
    expect(await current.text()).toBe("other writer");
    expect(f.calls.filter((x) => x.method === "DELETE").length).toBe(1);
  });

  test("refuses cleanup when the successful read loses its ETag header", async () => {
    const f = fixture();
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init),
        response = await f.fetchImpl(input, init);
      if (
        request.method === "GET" &&
        new URL(request.url).pathname.startsWith("/o/")
      ) {
        const headers = new Headers(response.headers);
        headers.delete("etag");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      return response;
    };
    await expect(runPostDeploySmoke(f.options, fetchImpl)).rejects.toThrow(
      "strong ETag",
    );
    expect(f.calls.filter((x) => x.method === "DELETE").length).toBe(0);
    expect(f.bucket.objects.size).toBe(1);
  });

  test("keeps explicit read-only mode free of object mutations", async () => {
    const f = fixture();
    const report = await runPostDeploySmoke(
      { ...f.options, skipMutation: true },
      f.fetchImpl,
    );
    expect(report.mutated).toBe(false);
    expect(f.calls.map((x) => x.method)).toEqual(["GET", "GET"]);
    expect(f.bucket.objects.size).toBe(0);
  });
});
