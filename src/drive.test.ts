import { describe, expect, test } from "bun:test";

import worker from "./worker.ts";
import { type AppSession, seal } from "./app-auth.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2Objects,
  R2PutOptions,
} from "./types.ts";

const SIGNING_SECRET = "drive-test-signing-key-abcdef";
const SESSION_SECRET = "drive-test-session-secret";

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
      body: new Response(entry.data.slice()).body as ReadableStream,
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

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? "";
    const objects: R2Object[] = [...this.store.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, entry]) => ({
        key,
        size: entry.data.byteLength,
        uploaded: new Date(0),
        body: new Response(entry.data.slice()).body as ReadableStream,
        arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
      }));
    return { objects, truncated: false };
  }
}

function makeEnv(bucket: R2Bucket, over: Partial<Env> = {}): Env {
  return { BUCKET: bucket, STORAGE_TOKEN_SIGNING_KEY: SIGNING_SECRET, ...over };
}

const AUTH_ENV: Partial<Env> = {
  APP_AUTH_REQUIRED: "1",
  OIDC_ISSUER_URL: "https://accounts.example",
  OIDC_CLIENT_ID: "client-1",
  APP_SESSION_SECRET: SESSION_SECRET,
};

async function sessionCookie(over: Partial<AppSession> = {}): Promise<string> {
  const session: AppSession = {
    sub: "user-1",
    name: "Taro",
    spaceIds: ["space-1"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  };
  return `takos_app_session=${await seal(session, SESSION_SECRET, "session")}`;
}

function request(
  method: string,
  path: string,
  opts: { cookie?: string; body?: string; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {};
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
    const env = makeEnv(bucket);

    const put = await worker.fetch(
      request("PUT", "/api/drive/file/docs%2Fnote.txt", {
        body: "hello drive",
        contentType: "text/plain",
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
    expect(get.headers.get("content-type")).toContain("text/plain");
    expect(await get.text()).toBe("hello drive");

    const list = await worker.fetch(request("GET", "/api/drive/list"), env);
    expect(list.status).toBe(200);
    const listing = (await list.json()) as { files: { path: string }[] };
    expect(listing.files.map((f) => f.path)).toEqual(["docs/note.txt"]);

    const del = await worker.fetch(
      request("DELETE", "/api/drive/file/docs%2Fnote.txt"),
      env,
    );
    expect(del.status).toBe(200);
    expect(bucket.store.size).toBe(0);
  });

  test("drive listing never exposes app-owned /o objects", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("ws1/office/records.json", "app data");
    await bucket.put("drive/mine.txt", "drive data");
    const res = await worker.fetch(
      request("GET", "/api/drive/list"),
      makeEnv(bucket),
    );
    const listing = (await res.json()) as { files: { path: string }[] };
    expect(listing.files.map((f) => f.path)).toEqual(["mine.txt"]);
  });

  test("invalid drive paths are rejected", async () => {
    const env = makeEnv(new MemoryBucket());
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
        spaceIds: ["space-1"],
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

  test("APP_SPACE_ID enforces workspace membership", async () => {
    const env = makeEnv(new MemoryBucket(), {
      ...AUTH_ENV,
      APP_SPACE_ID: "space-9",
    });
    const outsider = await worker.fetch(
      request("GET", "/api/drive/list", { cookie: await sessionCookie() }),
      env,
    );
    expect(outsider.status).toBe(403);

    const member = await worker.fetch(
      request("GET", "/api/drive/list", {
        cookie: await sessionCookie({ spaceIds: ["space-1", "space-9"] }),
      }),
      env,
    );
    expect(member.status).toBe(200);
  });

  test("auth misconfiguration fails closed with 503", async () => {
    const env = makeEnv(new MemoryBucket(), { APP_AUTH_REQUIRED: "1" });
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

  test("me reports auth-off installs and authenticated sessions", async () => {
    const openEnv = makeEnv(new MemoryBucket());
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
