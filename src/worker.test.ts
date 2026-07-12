import { describe, expect, test } from "bun:test";

import worker from "./worker.ts";
import { mintStorageToken, type StorageTokenPayload } from "./token.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2Objects,
  R2PutOptions,
} from "./types.ts";

const SECRET = "worker-test-signing-key-abcdef";

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
      body: new Response(entry.data).body as ReadableStream,
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

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? "";
    const objects: R2Object[] = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, entry]) => ({
        key,
        size: entry.data.byteLength,
        uploaded: new Date(0),
        body: new Response(entry.data).body as ReadableStream,
        arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
      }));
    return { objects, truncated: false };
  }
}

function makeEnv(bucket: R2Bucket): Env {
  return {
    BUCKET: bucket,
    STORAGE_TOKEN_SIGNING_KEY: SECRET,
    STORAGE_ADMIN_TOKEN: "storage-admin-token-at-least-32-characters",
  };
}

async function token(over: Partial<StorageTokenPayload> = {}): Promise<string> {
  return mintStorageToken(SECRET, {
    v: 1,
    ws: "ws1",
    sub: "inst-office",
    pfx: "ws1/office/",
    cap: ["r", "w", "d", "l"],
    aud: "storage.object",
    iat: Math.floor(Date.now() / 1000),
    ...over,
  });
}

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

describe("takos-storage worker", () => {
  test("healthz needs no auth", async () => {
    const res = await worker.fetch(
      request("GET", "/healthz"),
      makeEnv(new MemoryBucket()),
    );
    expect(res.status).toBe(200);
  });

  test("root console needs no auth", async () => {
    const res = await worker.fetch(
      request("GET", "/"),
      makeEnv(new MemoryBucket()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Takos Storage");
  });

  test("admin empty is fail-closed and removes every object", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("drive/user-file", "drive");
    await bucket.put("space/consumer/document", "app");
    const env = makeEnv(bucket);

    const unauthorized = await worker.fetch(
      new Request("https://storage.example/api/admin/empty", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "x-takos-storage-action": "empty",
        },
      }),
      env,
    );
    expect(unauthorized.status).toBe(404);
    expect(bucket.store.size).toBe(2);

    const purged = await worker.fetch(
      new Request("https://storage.example/api/admin/empty", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.STORAGE_ADMIN_TOKEN}`,
          "x-takos-storage-action": "empty",
        },
      }),
      env,
    );
    expect(purged.status).toBe(200);
    expect(await purged.json()).toEqual({ ok: true, deleted: 2 });
    expect(bucket.store.size).toBe(0);
  });

  test("/ui serves the same drive surface", async () => {
    const res = await worker.fetch(
      request("GET", "/ui"),
      makeEnv(new MemoryBucket()),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Takos Storage");
    expect(html).toContain('id="splash"');
  });

  test("console ships the drive-style file manager", async () => {
    const res = await worker.fetch(
      request("GET", "/"),
      makeEnv(new MemoryBucket()),
    );
    const html = await res.text();
    // The drive UI runs on the user session surface, never on tksvc_ credentials.
    expect(html).toContain("/api/drive/list");
    expect(html).toContain("/api/auth/me");
    expect(html).toContain("/api/auth/login");
    expect(html).not.toContain("tksvc_");
    // Drive chrome: New menu (upload / new folder), nav, list/grid, sorting.
    expect(html).toContain('data-new="upload"');
    expect(html).toContain('data-new="folder"');
    expect(html).toContain('data-nav="recent"');
    expect(html).toContain('data-view="list"');
    expect(html).toContain('data-view="grid"');
    expect(html).toContain('data-sort="name"');
    expect(html).toContain('data-sort="uploaded"');
    // Item actions confirm through dialogs, not window.confirm/prompt.
    expect(html).toContain('data-action="rename"');
    expect(html).toContain('data-action="delete"');
    expect(html).toContain('id="delete-dialog"');
    expect(html).not.toContain("window.confirm");
    expect(html).not.toContain("window.prompt");
    // en + ja catalogs ship together.
    expect(html).toContain("My Drive");
    expect(html).toContain("マイドライブ");
    expect(html).toContain("新しいフォルダ");
    expect(html).toContain("ファイルをアップロード");
    expect(html).toContain("最終更新");
  });

  test("PUT then GET round-trips within the prefix", async () => {
    const env = makeEnv(new MemoryBucket());
    const t = await token();
    const put = await worker.fetch(
      request("PUT", "/o/ws1/office/doc.md", { token: t, body: "hello" }),
      env,
    );
    expect(put.status).toBe(201);
    const get = await worker.fetch(
      request("GET", "/o/ws1/office/doc.md", { token: t }),
      env,
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("hello");
  });

  test("rejects missing token", async () => {
    const res = await worker.fetch(
      request("GET", "/o/ws1/office/doc.md"),
      makeEnv(new MemoryBucket()),
    );
    expect(res.status).toBe(401);
  });

  test("rejects writes from a read-only token", async () => {
    const env = makeEnv(new MemoryBucket());
    const readOnly = await token({ cap: ["r", "l"] });
    const res = await worker.fetch(
      request("PUT", "/o/ws1/office/doc.md", { token: readOnly, body: "x" }),
      env,
    );
    expect(res.status).toBe(403);
  });

  test("rejects access outside the token prefix", async () => {
    const env = makeEnv(new MemoryBucket());
    const t = await token({ pfx: "ws1/office/" });
    const res = await worker.fetch(
      request("GET", "/o/ws1/secrets/other.md", { token: t }),
      env,
    );
    expect(res.status).toBe(403);
  });

  test("lists only within the token prefix", async () => {
    const bucket = new MemoryBucket();
    const env = makeEnv(bucket);
    const t = await token();
    await worker.fetch(
      request("PUT", "/o/ws1/office/a.md", { token: t, body: "a" }),
      env,
    );
    await worker.fetch(
      request("PUT", "/o/ws1/office/b.md", { token: t, body: "b" }),
      env,
    );

    const ok = await worker.fetch(
      request("GET", "/o?prefix=ws1/office/", { token: t }),
      env,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).objects).toHaveLength(2);

    const outside = await worker.fetch(
      request("GET", "/o?prefix=ws1/secrets/", { token: t }),
      env,
    );
    expect(outside.status).toBe(403);
  });

  test("DELETE removes an object", async () => {
    const env = makeEnv(new MemoryBucket());
    const t = await token();
    await worker.fetch(
      request("PUT", "/o/ws1/office/gone.md", { token: t, body: "z" }),
      env,
    );
    const del = await worker.fetch(
      request("DELETE", "/o/ws1/office/gone.md", { token: t }),
      env,
    );
    expect(del.status).toBe(200);
    const get = await worker.fetch(
      request("GET", "/o/ws1/office/gone.md", { token: t }),
      env,
    );
    expect(get.status).toBe(404);
  });
});
