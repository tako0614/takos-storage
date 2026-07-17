import { describe, expect, test } from "bun:test";

import { createStorageWorker } from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
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
  readonly store = new Map<string, { data: Uint8Array; contentType: string }>();

  async get(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.data.byteLength,
      uploaded: new Date(0),
      httpEtag: '"etag"',
      httpMetadata: { contentType: entry.contentType },
      body: new Response(entry.data.slice().buffer).body as ReadableStream,
      arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.store.set(key, {
      data,
      contentType:
        options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
    return (await this.get(key)) as R2Object;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(key);
    }
  }

  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    const prefix = options.prefix ?? "";
    const objects = await Promise.all(
      [...this.store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => this.get(key) as Promise<R2Object>),
    );
    return { objects, truncated: false };
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
  opts: { token?: string; body?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "text/plain";
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

  test("fails closed when Interface OAuth owner configuration is absent", async () => {
    const response = await worker.fetch(
      request("GET", "/o/a.txt", { token: TOKENS.read }),
      { BUCKET: new MemoryBucket() },
    );
    expect(response.status).toBe(503);
  });

  test("never derives OAuth audience authority from a caller-controlled Host", async () => {
    const configured = makeEnv(new MemoryBucket());
    delete configured.APP_URL;
    const response = await worker.fetch(
      new Request("https://attacker-controlled.example/o/a.txt", {
        headers: { authorization: `Bearer ${TOKENS.read}` },
      }),
      configured,
    );
    expect(response.status).toBe(503);
  });
});
