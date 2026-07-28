import { describe, expect, test } from "bun:test";

import worker from "./worker.ts";
import { type AppSession, seal } from "./app-auth.ts";
import { MAX_STORED_OBJECT_BYTES } from "./http-body.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2Objects,
  R2PutOptions,
} from "./types.ts";

const SESSION_SECRET = "drive-test-session-secret";

class MemoryBucket implements R2Bucket {
  readonly store = new Map<
    string,
    {
      data: Uint8Array;
      contentType: string;
      etag: string;
      reportedSize?: number;
      customMetadata?: Record<string, string>;
    }
  >();
  private revision = 0;
  /** Caps a page like R2's own per-call maximum, so truncation is testable. */
  pageSize = 1000;

  async get(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.reportedSize ?? entry.data.byteLength,
      uploaded: new Date(0),
      httpEtag: entry.etag,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.customMetadata,
      body: new Response(entry.data.slice()).body as ReadableStream,
      arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const current = this.store.get(key);
    const onlyIf = options?.onlyIf;
    const ifMatch =
      onlyIf instanceof Headers ? onlyIf.get("if-match") : onlyIf?.etagMatches;
    const ifNoneMatch =
      onlyIf instanceof Headers
        ? onlyIf.get("if-none-match")
        : onlyIf?.etagDoesNotMatch;
    if (
      ifMatch !== null &&
      ifMatch !== undefined &&
      current?.etag !== ifMatch
    ) {
      return null;
    }
    if (ifNoneMatch === "*" && current) return null;
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.store.set(key, {
      data,
      contentType:
        options?.httpMetadata?.contentType ?? "application/octet-stream",
      etag: `"drive-${++this.revision}"`,
      customMetadata: options?.customMetadata,
    });
    return (await this.get(key)) as R2Object;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  // Paginates like R2 does (lexicographic keys, cursor = last key returned)
  // so the drive list contract is exercised end to end.
  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? "";
    const limit = Math.min(options?.limit ?? 1000, this.pageSize);
    const cursor = options?.cursor;
    const matching = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .filter(([key]) => (cursor ? key > cursor : true));
    const page = matching.slice(0, limit);
    const objects: R2Object[] = page.map(([key, entry]) => ({
      key,
      size: entry.data.byteLength,
      uploaded: new Date(0),
      body: new Response(entry.data.slice()).body as ReadableStream,
      arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
    }));
    const truncated = matching.length > page.length;
    return {
      objects,
      truncated,
      ...(truncated ? { cursor: page[page.length - 1]?.[0] } : {}),
    };
  }
}

function makeEnv(bucket: R2Bucket, over: Partial<Env> = {}): Env {
  return { BUCKET: bucket, ...over };
}

// Drive semantics tests run in the explicit public mode; auth-on is the
// default and is covered by its own tests below.
const PUBLIC_ENV: Partial<Env> = { ALLOW_UNAUTHENTICATED_DRIVE: "1" };

const AUTH_ENV: Partial<Env> = {
  APP_URL: "https://storage.example",
  OIDC_ISSUER_URL: "https://accounts.example",
  OIDC_CLIENT_ID: "client-1",
  APP_SESSION_SECRET: SESSION_SECRET,
};

async function sessionCookie(over: Partial<AppSession> = {}): Promise<string> {
  const session: AppSession = {
    sub: "user-1",
    name: "Taro",
    workspaceIds: ["workspace-1"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  };
  return `takos_app_session=${await seal(session, SESSION_SECRET, "session")}`;
}

function request(
  method: string,
  path: string,
  opts: {
    cookie?: string;
    body?: string;
    contentType?: string;
    headers?: Record<string, string>;
  } = {},
): Request {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.contentType) headers["content-type"] = opts.contentType;
  return new Request(`https://storage.example${path}`, {
    method,
    headers,
    body: opts.body,
  });
}

describe("workspace drive API", () => {
  test("drive files round-trip under the server-owned drive/ prefix", async () => {
    const bucket = new MemoryBucket();
    const env = makeEnv(bucket, PUBLIC_ENV);

    const put = await worker.fetch(
      request("PUT", "/api/drive/file/docs%2Fnote.txt", {
        body: "hello drive",
        contentType: "text/plain",
        headers: { "if-none-match": "*" },
      }),
      env,
    );
    expect(put.status).toBe(201);
    // The client path lands under drive/ — never at the bucket root where
    // app-owned /o objects live.
    expect([...bucket.store.keys()]).toEqual(["drive/docs/note.txt"]);

    const get = await worker.fetch(
      request("GET", "/api/drive/file/docs%2Fnote.txt"),
      env,
    );
    expect(get.status).toBe(200);
    // Stored bytes come back inert: the uploader-chosen type is reported in a
    // side header only, never as the rendered content type.
    expect(get.headers.get("content-type")).toBe("application/octet-stream");
    expect(get.headers.get("x-takos-storage-content-type")).toBe("text/plain");
    expect(get.headers.get("content-disposition")).toContain("attachment");
    expect(get.headers.get("x-content-type-options")).toBe("nosniff");
    expect(get.headers.get("content-security-policy")).toContain("sandbox");
    expect(await get.text()).toBe("hello drive");

    const list = await worker.fetch(request("GET", "/api/drive/list"), env);
    expect(list.status).toBe(200);
    const listing = (await list.json()) as { files: { path: string }[] };
    expect(listing.files.map((f) => f.path)).toEqual(["docs/note.txt"]);

    const del = await worker.fetch(
      request("DELETE", "/api/drive/file/docs%2Fnote.txt", {
        headers: { "if-match": get.headers.get("etag") ?? "" },
      }),
      env,
    );
    expect(del.status).toBe(200);
    expect(bucket.store.size).toBe(0);
  });

  test("requires create/update CAS and preserves an existing file", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("drive/existing.txt", "original");
    const env = makeEnv(bucket, PUBLIC_ENV);

    const missing = await worker.fetch(
      request("PUT", "/api/drive/file/new.txt", { body: "new" }),
      env,
    );
    expect(missing.status).toBe(428);

    const clobber = await worker.fetch(
      request("PUT", "/api/drive/file/existing.txt", {
        body: "replacement",
        headers: { "if-none-match": "*" },
      }),
      env,
    );
    expect(clobber.status).toBe(412);
    expect(
      new TextDecoder().decode(bucket.store.get("drive/existing.txt")?.data),
    ).toBe("original");
  });

  test("deletes one exact revision and rejects stale confirmation", async () => {
    const bucket = new MemoryBucket();
    const original = await bucket.put("drive/file.txt", "original");
    const env = makeEnv(bucket, PUBLIC_ENV);

    const stale = await worker.fetch(
      request("DELETE", "/api/drive/file/file.txt", {
        headers: { "if-match": '"stale"' },
      }),
      env,
    );
    expect(stale.status).toBe(412);
    expect(bucket.store.has("drive/file.txt")).toBe(true);

    const deleted = await worker.fetch(
      request("DELETE", "/api/drive/file/file.txt", {
        headers: { "if-match": original?.httpEtag ?? "" },
      }),
      env,
    );
    expect(deleted.status).toBe(200);
    expect(bucket.store.has("drive/file.txt")).toBe(false);
  });

  test("moves one file with create-only destination semantics", async () => {
    const bucket = new MemoryBucket();
    const source = await bucket.put("drive/source.txt", "source");
    await bucket.put("drive/existing.txt", "existing");
    const env = makeEnv(bucket, PUBLIC_ENV);

    const conflict = await worker.fetch(
      request("POST", "/api/drive/move", {
        contentType: "application/json",
        body: JSON.stringify({
          source_path: "source.txt",
          destination_path: "existing.txt",
          source_etag: source?.httpEtag,
        }),
      }),
      env,
    );
    expect(conflict.status).toBe(409);
    expect(bucket.store.has("drive/source.txt")).toBe(true);

    const moved = await worker.fetch(
      request("POST", "/api/drive/move", {
        contentType: "application/json",
        body: JSON.stringify({
          source_path: "source.txt",
          destination_path: "moved.txt",
          source_etag: source?.httpEtag,
        }),
      }),
      env,
    );
    expect(moved.status).toBe(200);
    expect(bucket.store.has("drive/source.txt")).toBe(false);
    expect(
      new TextDecoder().decode(bucket.store.get("drive/moved.txt")?.data),
    ).toBe("source");
  });

  test("refuses to move a source revision that no longer matches", async () => {
    const bucket = new MemoryBucket();
    const original = await bucket.put("drive/source.txt", "original");
    await bucket.put("drive/source.txt", "replacement");

    const moved = await worker.fetch(
      request("POST", "/api/drive/move", {
        contentType: "application/json",
        body: JSON.stringify({
          source_path: "source.txt",
          destination_path: "copy.txt",
          source_etag: original?.httpEtag,
        }),
      }),
      makeEnv(bucket, PUBLIC_ENV),
    );
    expect(moved.status).toBe(412);
    expect(
      new TextDecoder().decode(bucket.store.get("drive/source.txt")?.data),
    ).toBe("replacement");
    expect(bucket.store.has("drive/copy.txt")).toBe(false);
  });

  test("refuses to move a pre-existing object above the drive ceiling", async () => {
    const bucket = new MemoryBucket();
    bucket.store.set("drive/oversized.bin", {
      data: new Uint8Array(),
      contentType: "application/octet-stream",
      etag: '"oversized"',
      reportedSize: MAX_STORED_OBJECT_BYTES + 1,
    });

    const moved = await worker.fetch(
      request("POST", "/api/drive/move", {
        contentType: "application/json",
        body: JSON.stringify({
          source_path: "oversized.bin",
          destination_path: "copy.bin",
          source_etag: '"oversized"',
        }),
      }),
      makeEnv(bucket, PUBLIC_ENV),
    );
    expect(moved.status).toBe(413);
    expect(bucket.store.has("drive/oversized.bin")).toBe(true);
    expect(bucket.store.has("drive/copy.bin")).toBe(false);
  });

  test("refuses partial deletion of a folder marker", async () => {
    const bucket = new MemoryBucket();
    const marker = await bucket.put("drive/folder/", "");
    await bucket.put("drive/folder/nested.txt", "nested");

    const deleted = await worker.fetch(
      request("DELETE", "/api/drive/file/folder%2F", {
        headers: { "if-match": marker?.httpEtag ?? "" },
      }),
      makeEnv(bucket, PUBLIC_ENV),
    );
    expect(deleted.status).toBe(400);
    expect(bucket.store.has("drive/folder/")).toBe(true);
    expect(bucket.store.has("drive/folder/nested.txt")).toBe(true);
  });

  test("a truncated drive listing hands back a usable cursor", async () => {
    // The console follows this cursor for complete browsing and usage totals.
    const bucket = new MemoryBucket();
    bucket.pageSize = 1;
    for (let index = 0; index < 3; index++) {
      await bucket.put(`drive/file-${index}.txt`, "x");
    }
    const env = makeEnv(bucket, PUBLIC_ENV);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const res = await worker.fetch(
        request(
          "GET",
          `/api/drive/list${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
        env,
      );
      const body = (await res.json()) as {
        files: { path: string }[];
        truncated: boolean;
        cursor?: string;
      };
      seen.push(...body.files.map((file) => file.path));
      if (!body.truncated) break;
      expect(body.cursor).toBeTruthy();
      cursor = body.cursor;
    }
    expect(seen).toEqual(["file-0.txt", "file-1.txt", "file-2.txt"]);
  });

  test("drive listing never exposes app-owned /o objects", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("ws1/office/records.json", "app data");
    await bucket.put("drive/mine.txt", "drive data");
    const res = await worker.fetch(
      request("GET", "/api/drive/list"),
      makeEnv(bucket, PUBLIC_ENV),
    );
    const listing = (await res.json()) as { files: { path: string }[] };
    expect(listing.files.map((f) => f.path)).toEqual(["mine.txt"]);
  });

  test("invalid drive paths are rejected", async () => {
    const env = makeEnv(new MemoryBucket(), PUBLIC_ENV);
    expect(
      (
        await worker.fetch(
          request("PUT", "/api/drive/file/", { body: "x" }),
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await worker.fetch(
          request("PUT", "/api/drive/file/%2Fabs", { body: "x" }),
          env,
        )
      ).status,
    ).toBe(400);
    const multibyte = "界".repeat(400);
    expect(
      (
        await worker.fetch(
          request("PUT", `/api/drive/file/${encodeURIComponent(multibyte)}`, {
            body: "x",
          }),
          env,
        )
      ).status,
    ).toBe(400);
  });

  test("drive requires a session when app auth is enabled", async () => {
    const env = makeEnv(new MemoryBucket(), AUTH_ENV);
    const anonymous = await worker.fetch(
      request("GET", "/api/drive/list"),
      env,
    );
    expect(anonymous.status).toBe(401);

    const withSession = await worker.fetch(
      request("GET", "/api/drive/list", { cookie: await sessionCookie() }),
      env,
    );
    expect(withSession.status).toBe(200);
  });

  test("an expired or tampered session is rejected", async () => {
    const env = makeEnv(new MemoryBucket(), AUTH_ENV);
    const expired = await worker.fetch(
      request("GET", "/api/drive/list", {
        cookie: await sessionCookie({
          exp: Math.floor(Date.now() / 1000) - 10,
        }),
      }),
      env,
    );
    expect(expired.status).toBe(401);

    const good = await sessionCookie();
    const tampered = await worker.fetch(
      request("GET", "/api/drive/list", { cookie: good.slice(0, -2) + "xx" }),
      env,
    );
    expect(tampered.status).toBe(401);
  });

  test("a state cookie cannot be replayed as a session cookie", async () => {
    const env = makeEnv(new MemoryBucket(), AUTH_ENV);
    const stateSealed = await seal(
      {
        sub: "user-1",
        workspaceIds: ["workspace-1"],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      SESSION_SECRET,
      "state",
    );
    const res = await worker.fetch(
      request("GET", "/api/drive/list", {
        cookie: `takos_app_session=${stateSealed}`,
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  test("APP_WORKSPACE_ID enforces workspace membership", async () => {
    const env = makeEnv(new MemoryBucket(), {
      ...AUTH_ENV,
      APP_WORKSPACE_ID: "workspace-9",
    });
    const outsider = await worker.fetch(
      request("GET", "/api/drive/list", { cookie: await sessionCookie() }),
      env,
    );
    expect(outsider.status).toBe(403);

    const member = await worker.fetch(
      request("GET", "/api/drive/list", {
        cookie: await sessionCookie({
          workspaceIds: ["workspace-1", "workspace-9"],
        }),
      }),
      env,
    );
    expect(member.status).toBe(200);
  });

  test("an install with no Accounts wiring fails closed with 503", async () => {
    // Authentication is the default, so a bare apply must name what is
    // missing rather than serve the drive anonymously.
    const env = makeEnv(new MemoryBucket());
    const res = await worker.fetch(request("GET", "/api/drive/list"), env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { missing: string[] };
    expect(body.missing).toContain("OIDC_ISSUER_URL");
  });
});

describe("drive auth routes", () => {
  test("login redirects to the issuer with PKCE and a sealed state cookie", async () => {
    const env = makeEnv(new MemoryBucket(), AUTH_ENV);
    const res = await worker.fetch(
      request("GET", "/api/auth/login?return_to=%2Ffoo"),
      env,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.example");
    expect(location.pathname).toBe("/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("client-1");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://storage.example/api/auth/callback/takos",
    );
    expect(res.headers.get("set-cookie")).toContain("takos_app_oauth_state=");
  });

  test("uses APP_URL rather than a caller-controlled request host for callbacks", async () => {
    const env = makeEnv(new MemoryBucket(), {
      ...AUTH_ENV,
      APP_URL: "https://canonical-storage.example",
    });
    const res = await worker.fetch(
      new Request("https://attacker-controlled.example/api/auth/login"),
      env,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://canonical-storage.example/api/auth/callback/takos",
    );
  });

  test("rejects a non-HTTPS OIDC issuer before creating an OAuth redirect", async () => {
    const res = await worker.fetch(
      request("GET", "/api/auth/login"),
      makeEnv(new MemoryBucket(), {
        ...AUTH_ENV,
        OIDC_ISSUER_URL: "http://accounts.example",
      }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "app_auth_not_configured",
      invalid: ["OIDC_ISSUER_URL"],
    });
    expect(res.headers.get("location")).toBeNull();
  });

  test("me reports auth-off installs and authenticated sessions", async () => {
    const openEnv = makeEnv(new MemoryBucket(), PUBLIC_ENV);
    const open = await worker.fetch(request("GET", "/api/auth/me"), openEnv);
    expect(await open.json()).toEqual({ required: false });

    const env = makeEnv(new MemoryBucket(), AUTH_ENV);
    expect(
      (await worker.fetch(request("GET", "/api/auth/me"), env)).status,
    ).toBe(401);
    const me = await worker.fetch(
      request("GET", "/api/auth/me", { cookie: await sessionCookie() }),
      env,
    );
    expect(await me.json()).toEqual({
      required: true,
      sub: "user-1",
      name: "Taro",
    });
  });

  test("logout clears the session cookie", async () => {
    const env = makeEnv(new MemoryBucket(), AUTH_ENV);
    const res = await worker.fetch(request("POST", "/api/auth/logout"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("takos_app_session=;");
  });
});
