import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { createStorageWorker } from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2Objects,
  R2PutOptions,
} from "./types.ts";

const TOKENS = {
  read: "taksrv_storage_read",
  write: "taksrv_storage_write",
  delete: "taksrv_storage_delete",
  list: "taksrv_storage_list",
  otherBindingRead: "taksrv_storage_other_binding_read",
  wrongCapsule: "taksrv_storage_wrong_capsule",
} as const;

class MemoryBucket implements R2Bucket {
  pageSize = 1000;
  readonly store = new Map<
    string,
    {
      data: Uint8Array;
      contentType: string;
      customMetadata?: Record<string, string>;
    }
  >();

  async head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.data.byteLength,
      uploaded: new Date(0),
      httpEtag: `"${createHash("md5").update(entry.data).digest("hex")}"`,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.customMetadata,
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.data.byteLength,
      uploaded: new Date(0),
      httpEtag: `"${createHash("md5").update(entry.data).digest("hex")}"`,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.customMetadata,
      body: new Response(entry.data.slice().buffer).body as ReadableStream,
      arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const onlyIf = options?.onlyIf;
    const ifMatch =
      onlyIf instanceof Headers
        ? onlyIf.get("if-match")
        : onlyIf?.etagMatches === undefined
          ? undefined
          : `"${onlyIf.etagMatches}"`;
    const ifNone =
      onlyIf instanceof Headers
        ? onlyIf.get("if-none-match")
        : onlyIf?.etagDoesNotMatch;
    if (ifMatch != null && (await this.head(key))?.httpEtag !== ifMatch)
      return null;
    if (ifNone === "*" && this.store.has(key)) return null;
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.store.set(key, {
      data,
      contentType:
        options?.httpMetadata?.contentType ?? "application/octet-stream",
      customMetadata: options?.customMetadata,
    });
    return (await this.head(key)) as R2Object;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(key);
    }
  }

  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    const prefix = options.prefix ?? "";
    const offset = options.cursor ? Number(options.cursor) : 0;
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const page = keys.slice(
      offset,
      offset + Math.min(options.limit ?? 1000, this.pageSize),
    );
    const objects = await Promise.all(
      page.map(async (key) => {
        const object = (await this.head(key))!;
        if (!options.include?.includes("customMetadata"))
          delete object.customMetadata;
        return object;
      }),
    );
    const next = offset + page.length;
    return {
      objects,
      truncated: next < keys.length,
      ...(next < keys.length ? { cursor: String(next) } : {}),
    };
  }
}

function makeEnv(bucket: R2Bucket): Env {
  return {
    BUCKET: bucket,
    APP_URL: "https://storage.example",
    OIDC_ISSUER_URL: "https://accounts.example",
    APP_WORKSPACE_ID: "workspace_a",
    APP_CAPSULE_ID: "capsule_storage",
  };
}

const worker = createStorageWorker(async (_input, init) => {
  const token = /^Bearer (.+)$/u.exec(
    new Headers(init?.headers).get("authorization") ?? "",
  )?.[1];
  const permissionByToken: Record<string, string> = {
    [TOKENS.read]: "storage.object.read",
    [TOKENS.write]: "storage.object.write",
    [TOKENS.delete]: "storage.object.delete",
    [TOKENS.list]: "storage.object.list",
    [TOKENS.otherBindingRead]: "storage.object.read",
    [TOKENS.wrongCapsule]: "storage.object.read",
  };
  const permission = token ? permissionByToken[token] : undefined;
  if (!permission) return Response.json({}, { status: 401 });
  return Response.json({
    token_use: "interface_oauth",
    sub: "principal_storage",
    aud: "https://storage.example/o",
    scope: permission,
    takosumi: {
      workspace_id: "workspace_a",
      capsule_id:
        token === TOKENS.wrongCapsule ? "capsule_other" : "capsule_storage",
      interface_id: "interface_storage_object",
      interface_binding_id:
        token === TOKENS.otherBindingRead ? "binding_b" : "binding_a",
      interface_resolved_revision: 4,
    },
  });
});

function request(
  method: string,
  path: string,
  opts: {
    token?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined && headers["content-type"] === undefined)
    headers["content-type"] = "text/plain";
  return new Request(`https://storage.example${path}`, {
    method,
    headers,
    body: opts.body,
  });
}

describe("takos-storage Interface OAuth worker", () => {
  test("keeps health and browser console public", async () => {
    const env = makeEnv(new MemoryBucket());
    expect((await worker.fetch(request("GET", "/healthz"), env)).status).toBe(
      200,
    );
    const root = await worker.fetch(request("GET", "/"), env);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("Takos Storage");
  });

  test("serves the launcher icon referenced by service-side Interface metadata", async () => {
    const response = await worker.fetch(
      request("GET", "/icons/takos-storage.svg"),
      makeEnv(new MemoryBucket()),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  test("does not expose a standing destructive admin endpoint", async () => {
    const response = await worker.fetch(
      request("POST", "/api/admin/empty"),
      makeEnv(new MemoryBucket()),
    );
    expect(response.status).toBe(404);
  });

  test("round-trips inside the authorizing InterfaceBinding namespace", async () => {
    const bucket = new MemoryBucket();
    const env = makeEnv(bucket);
    const put = await worker.fetch(
      request("PUT", "/o/docs/a.txt", {
        token: TOKENS.write,
        body: "hello",
      }),
      env,
    );
    expect(put.status).toBe(201);
    expect([...bucket.store.keys()]).toEqual([
      "interface-bindings/binding_a/docs/a.txt",
    ]);
    const get = await worker.fetch(
      request("GET", "/o/docs/a.txt", { token: TOKENS.read }),
      env,
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("hello");
  });

  test("rejects a stale object deletion without losing the current bytes", async () => {
    const env = makeEnv(new MemoryBucket());
    await worker.fetch(
      request("PUT", "/o/note.txt", { token: TOKENS.write, body: "original" }),
      env,
    );
    const original = await worker.fetch(
      request("GET", "/o/note.txt", { token: TOKENS.read }),
      env,
    );
    const etag = original.headers.get("etag")!;
    expect(
      (
        await worker.fetch(
          request("PUT", "/o/note.txt", {
            token: TOKENS.write,
            body: "current",
            headers: { "if-match": etag },
          }),
          env,
        )
      ).status,
    ).toBe(201);
    const stale = await worker.fetch(
      request("DELETE", "/o/note.txt", {
        token: TOKENS.delete,
        headers: { "if-match": etag },
      }),
      env,
    );
    expect(stale.status).toBe(412);
    const current = await worker.fetch(
      request("GET", "/o/note.txt", { token: TOKENS.read }),
      env,
    );
    expect(current.status).toBe(200);
    expect(await current.text()).toBe("current");
    const deleted = await worker.fetch(
      request("DELETE", "/o/note.txt", {
        token: TOKENS.delete,
        headers: { "if-match": current.headers.get("etag")! },
      }),
      env,
    );
    expect(deleted.status).toBe(200);
    expect(
      (
        await worker.fetch(
          request("GET", "/o/note.txt", { token: TOKENS.read }),
          env,
        )
      ).status,
    ).toBe(404);
  });

  test("defaults PUT to create-only and refuses invalid mutation conditions", async () => {
    const env = makeEnv(new MemoryBucket());
    await worker.fetch(
      request("PUT", "/o/note.txt", { token: TOKENS.write, body: "original" }),
      env,
    );
    const etag = (
      await worker.fetch(
        request("HEAD", "/o/note.txt", { token: TOKENS.read }),
        env,
      )
    ).headers.get("etag")!;
    expect(
      (
        await worker.fetch(
          request("PUT", "/o/note.txt", {
            token: TOKENS.write,
            body: "unconditional",
          }),
          env,
        )
      ).status,
    ).toBe(412);
    expect(
      (
        await worker.fetch(
          request("DELETE", "/o/note.txt", { token: TOKENS.delete }),
          env,
        )
      ).status,
    ).toBe(428);
    for (const value of [
      "*",
      "bare",
      'W/"weak"',
      '"one","two"',
      '"' + "x".repeat(256) + '"',
    ]) {
      for (const method of ["PUT", "DELETE"] as const) {
        const invalid = await worker.fetch(
          request(method, "/o/note.txt", {
            token: method === "PUT" ? TOKENS.write : TOKENS.delete,
            ...(method === "PUT" ? { body: "bad" } : {}),
            headers: { "if-match": value },
          }),
          env,
        );
        expect(invalid.status).toBe(400);
      }
    }
    expect(
      (
        await worker.fetch(
          request("PUT", "/o/note.txt", {
            token: TOKENS.write,
            body: "bad",
            headers: { "if-match": etag, "if-none-match": "*" },
          }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      await (
        await worker.fetch(
          request("GET", "/o/note.txt", { token: TOKENS.read }),
          env,
        )
      ).text(),
    ).toBe("original");
  });

  test.each([
    ["application/json", '{"safe":true}'],
    ["text/html", "<script>untrusted()</script>"],
    [
      "image/svg+xml",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>untrusted()</script></svg>',
    ],
  ])(
    "keeps %s bytes and media type in an inert attachment",
    async (contentType, body) => {
      const env = makeEnv(new MemoryBucket());
      await worker.fetch(
        request("PUT", "/o/file", {
          token: TOKENS.write,
          body,
          headers: { "content-type": contentType },
        }),
        env,
      );
      for (const method of ["GET", "HEAD"]) {
        const response = await worker.fetch(
          request(method, "/o/file", { token: TOKENS.read }),
          env,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(contentType);
        expect(response.headers.get("content-disposition")).toBe("attachment");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-security-policy")).toBe(
          "default-src 'none'; sandbox",
        );
        if (method === "GET") expect(await response.text()).toBe(body);
      }
    },
  );

  test("hides residual deletion markers and preserves the underlying list cursor", async () => {
    class CleanupFailureBucket extends MemoryBucket {
      override async delete(): Promise<void> {
        throw new Error("synthetic cleanup failure");
      }
    }
    const bucket = new CleanupFailureBucket(),
      env = makeEnv(bucket);
    bucket.pageSize = 1;
    for (const path of ["a.txt", "z.txt"])
      await worker.fetch(
        request("PUT", "/o/" + path, { token: TOKENS.write, body: "" }),
        env,
      );
    const etag = (
      await worker.fetch(
        request("HEAD", "/o/a.txt", { token: TOKENS.read }),
        env,
      )
    ).headers.get("etag")!;
    await expect(
      worker.fetch(
        request("DELETE", "/o/a.txt", {
          token: TOKENS.delete,
          headers: { "if-match": etag },
        }),
        env,
      ),
    ).rejects.toThrow("synthetic cleanup failure");
    for (const method of ["GET", "HEAD"])
      expect(
        (
          await worker.fetch(
            request(method, "/o/a.txt", { token: TOKENS.read }),
            env,
          )
        ).status,
      ).toBe(404);
    const first = (await (
      await worker.fetch(request("GET", "/o", { token: TOKENS.list }), env)
    ).json()) as { objects: unknown[]; truncated: boolean; cursor: string };
    expect(first).toEqual({ objects: [], truncated: true, cursor: "1" });
    const next = (await (
      await worker.fetch(
        request("GET", "/o?cursor=" + first.cursor, { token: TOKENS.list }),
        env,
      )
    ).json()) as { objects: Array<{ key: string }> };
    expect(next.objects.map((x) => x.key)).toEqual(["z.txt"]);
    for (const headers of [{}, { "if-match": etag }] as Array<
      Record<string, string>
    >)
      expect(
        (
          await worker.fetch(
            request("PUT", "/o/a.txt", {
              token: TOKENS.write,
              body: "late",
              headers,
            }),
            env,
          )
        ).status,
      ).toBe(412);
  });

  test("requires one exact permission and exact owner evidence", async () => {
    const env = makeEnv(new MemoryBucket());
    const readOnWrite = await worker.fetch(
      request("PUT", "/o/a.txt", { token: TOKENS.read, body: "x" }),
      env,
    );
    expect(readOnWrite.status).toBe(401);
    const wrongCapsule = await worker.fetch(
      request("GET", "/o/a.txt", { token: TOKENS.wrongCapsule }),
      env,
    );
    expect(wrongCapsule.status).toBe(401);
  });

  test("rejects declared oversized writes before touching R2", async () => {
    const env = makeEnv(new MemoryBucket());
    const oversized = request("PUT", "/o/huge.bin", {
      token: TOKENS.write,
      body: "x",
    });
    oversized.headers.set("content-length", String(50 * 1024 * 1024 + 1));
    const response = await worker.fetch(oversized, env);
    expect(response.status).toBe(413);
  });

  test("isolates objects across InterfaceBindings", async () => {
    const env = makeEnv(new MemoryBucket());
    await worker.fetch(
      request("PUT", "/o/private.txt", {
        token: TOKENS.write,
        body: "binding a",
      }),
      env,
    );
    const other = await worker.fetch(
      request("GET", "/o/private.txt", { token: TOKENS.otherBindingRead }),
      env,
    );
    expect(other.status).toBe(404);
  });

  test("lists virtual keys without exposing the physical namespace", async () => {
    const env = makeEnv(new MemoryBucket());
    await worker.fetch(
      request("PUT", "/o/docs/a.txt", {
        token: TOKENS.write,
        body: "a",
      }),
      env,
    );
    const list = await worker.fetch(
      request("GET", "/o?prefix=docs/", { token: TOKENS.list }),
      env,
    );
    const body = (await list.json()) as { objects: Array<{ key: string }> };
    expect(list.status).toBe(200);
    expect(body.objects.map((entry) => entry.key)).toEqual(["docs/a.txt"]);
  });

  test("rejects keys whose binding-prefixed UTF-8 representation exceeds R2", async () => {
    const bucket = new MemoryBucket();
    const response = await worker.fetch(
      request("PUT", `/o/${"a".repeat(1000)}`, {
        token: TOKENS.write,
        body: "x",
      }),
      makeEnv(bucket),
    );
    expect(response.status).toBe(400);
    expect(bucket.store.size).toBe(0);
  });

  test("fails closed when Interface OAuth owner configuration is absent", async () => {
    const response = await worker.fetch(
      request("GET", "/o/a.txt", { token: TOKENS.read }),
      { BUCKET: new MemoryBucket() },
    );
    expect(response.status).toBe(503);
  });

  test("derives the exact request origin and rejects a token minted for another origin", async () => {
    const configured = makeEnv(new MemoryBucket());
    delete configured.APP_URL;
    const response = await worker.fetch(
      new Request("https://attacker-controlled.example/o/a.txt", {
        headers: { authorization: `Bearer ${TOKENS.read}` },
      }),
      configured,
    );
    expect(response.status).toBe(401);
  });
});
