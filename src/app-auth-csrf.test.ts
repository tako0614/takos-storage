// takos-secret-scan: synthetic — local issuer/session and disposable bucket only.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import worker from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2Object,
  R2ObjectBody,
  R2PutOptions,
} from "./types.ts";

class Bucket implements R2Bucket {
  objects = new Map<
    string,
    {
      bytes: Uint8Array;
      etag: string;
      type: string;
      metadata?: Record<string, string>;
    }
  >();
  effects = 0;
  async head(key: string): Promise<R2Object | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    const bytes = item.bytes;
    return {
      key,
      size: bytes.length,
      uploaded: new Date(0),
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
      customMetadata: item.metadata,
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.objects.get(key);
    if (!item) return null;
    const bytes = item.bytes.slice();
    return {
      key,
      size: bytes.length,
      uploaded: new Date(0),
      httpEtag: item.etag,
      httpMetadata: { contentType: item.type },
      customMetadata: item.metadata,
      body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer,
    };
  }
  async put(
    key: string,
    body: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const old = this.objects.get(key),
      condition = options?.onlyIf;
    const match =
      condition instanceof Headers
        ? condition.get("if-match")
        : condition?.etagMatches;
    const absent =
      condition instanceof Headers
        ? condition.get("if-none-match")
        : condition?.etagDoesNotMatch;
    if (match != null && old?.etag !== match) return null;
    if (absent === "*" && old) return null;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      bytes,
      etag: `"test-${++this.effects}"`,
      type: options?.httpMetadata?.contentType ?? "application/octet-stream",
      metadata: options?.customMetadata,
    });
    return this.head(key);
  }
  async delete(key: string) {
    if (this.objects.delete(key)) this.effects++;
  }
  async list() {
    const objects = await Promise.all(
      [...this.objects.keys()].sort().map((key) => this.head(key)),
    );
    return {
      objects: objects.filter((x): x is R2Object => x !== null),
      truncated: false,
    };
  }
}

const origin = "https://storage.csrf-fixture.example",
  issuer = "https://accounts.csrf-fixture.example";
const sibling = "https://evil.storage.csrf-fixture.example";
let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});
function cookie(response: Response, name: string) {
  const line = response.headers
    .getSetCookie()
    .find((x) => x.startsWith(name + "="));
  expect(line).toBeDefined();
  return line!.split(";", 1)[0]!;
}
async function fixture(options: { legacy?: boolean; portable?: boolean } = {}) {
  const bucket = new Bucket();
  const env: Env = {
    BUCKET: bucket,
    APP_URL: origin,
    OIDC_ISSUER_URL: issuer,
    OIDC_CLIENT_ID: "csrf-fixture-client",
    APP_SESSION_SECRET: "synthetic-csrf-fixture-session-secret",
    APP_WORKSPACE_ID: "csrf-fixture-workspace",
    ...(!options.legacy ? { APP_CAPSULE_ID: "csrf-fixture-app" } : {}),
  };
  if (options.portable) {
    delete env.APP_URL;
    env.OIDC_REDIRECT_URI = origin + "/api/auth/callback/takos";
  }
  let member = true,
    userinfoCalls = 0;
  restoreFetch?.();
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === issuer + "/oauth/token")
          return Response.json({
            access_token: "synthetic-csrf-fixture-access-token",
          });
        if (url === issuer + "/oauth/userinfo") {
          userinfoCalls++;
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer synthetic-csrf-fixture-access-token",
          );
          return Response.json({
            sub: "csrf-fixture-member",
            workspace_memberships: ["csrf-fixture-workspace"],
            ...(!options.legacy
              ? {
                  takosumi: {
                    capsule_id: "csrf-fixture-app",
                    ...(member ? { app_role: "member" } : {}),
                  },
                }
              : {}),
          });
        }
        throw Error("unexpected external fetch in local issuer fixture");
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  restoreFetch = () => fetchMock.mockRestore();
  const login = await worker.fetch(
    new Request(origin + "/api/auth/login"),
    env,
  );
  const state = new URL(login.headers.get("location")!).searchParams.get(
    "state",
  )!;
  const callback = await worker.fetch(
    new Request(
      origin +
        "/api/auth/callback/takos?code=csrf-fixture-code&state=" +
        encodeURIComponent(state),
      { headers: { cookie: cookie(login, "takos_app_oauth_state") } },
    ),
    env,
  );
  expect(callback.status).toBe(302);
  const session = cookie(callback, "takos_app_session");
  const line = callback.headers.get("set-cookie")!;
  expect(line).toContain("SameSite=Lax");
  expect(line).toContain("Secure");
  expect(line).not.toContain("Domain=");
  const send = (
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
    authenticated = true,
  ) =>
    worker.fetch(
      new Request(origin + path, {
        method,
        headers: { ...(authenticated ? { cookie: session } : {}), ...headers },
        ...(body !== undefined ? { body } : {}),
      }),
      env,
    );
  const seed = await send(
    "PUT",
    "/api/drive/file/source.txt",
    { origin, "if-none-match": "*" },
    "original",
  );
  expect(seed.status).toBe(201);
  const head = await send("HEAD", "/api/drive/file/source.txt");
  expect(head.status).toBe(200);
  const etag = head.headers.get("etag")!;
  expect(etag).toBeTruthy();
  const body = JSON.stringify({
    source_path: "source.txt",
    destination_path: "moved.txt",
    source_etag: etag,
  });
  const move = (headers: Record<string, string>, authenticated = true) =>
    send(
      "POST",
      "/api/drive/move",
      { "content-type": "text/plain", ...headers },
      body,
      authenticated,
    );
  const snapshot = () => ({
    effects: bucket.effects,
    objects: [...bucket.objects.entries()].map(([key, x]) => ({
      key,
      etag: x.etag,
      bytes: [...x.bytes],
      metadata: x.metadata,
    })),
  });
  return {
    env,
    bucket,
    session,
    send,
    move,
    snapshot,
    etag,
    member: (value: boolean) => {
      member = value;
    },
    userinfoCalls: () => userinfoCalls,
  };
}

describe("Cookie Drive mutations reject cross-origin requests before effects", () => {
  test("same-site text/plain move preserves source/destination and skips live lookup", async () => {
    const f = await fixture(),
      before = f.snapshot(),
      calls = f.userinfoCalls();
    const response = await f.move({
      origin: sibling,
      "sec-fetch-site": "same-site",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(f.snapshot()).toEqual(before);
    expect(f.userinfoCalls()).toBe(calls);
  });
  test("an unrelated Bearer cannot bypass the Cookie mutation gate", async () => {
    const f = await fixture(),
      before = f.snapshot();
    const response = await f.move({
      origin: sibling,
      "sec-fetch-site": "same-site",
      authorization: "Bearer unrelated-synthetic-client",
    });
    expect(response.status).toBe(403);
    expect(f.snapshot()).toEqual(before);
  });
  test("same-site logout neither clears the cookie nor invalidates the session", async () => {
    const f = await fixture();
    const response = await f.send("POST", "/api/auth/logout", {
      origin: sibling,
      "sec-fetch-site": "same-site",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await f.send("GET", "/api/drive/list")).status).toBe(200);
  });
  test("normal origin moves one exact revision and logout still clears its cookie", async () => {
    const f = await fixture(),
      effects = f.bucket.effects;
    expect((await f.move({ origin })).status).toBe(200);
    // Destination copy, conditional source tombstone, then physical removal.
    expect(f.bucket.effects).toBe(effects + 3);
    expect(f.bucket.objects.has("drive/source.txt")).toBe(false);
    expect(
      new TextDecoder().decode(f.bucket.objects.get("drive/moved.txt")!.bytes),
    ).toBe("original");
    const logout = await f.send("POST", "/api/auth/logout", { origin });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  test("a missing Origin requires same-origin browser metadata", async () => {
    const f = await fixture(),
      before = f.snapshot();
    for (const site of [undefined, "same-site", "cross-site", "none", ""]) {
      const response = await f.move(
        site === undefined ? {} : { "sec-fetch-site": site },
      );
      expect(response.status).toBe(403);
      expect(f.snapshot()).toEqual(before);
    }
    expect((await f.move({ "sec-fetch-site": "same-origin" })).status).toBe(
      200,
    );
  });
  test("same-origin metadata cannot override an untrusted or malformed Origin", async () => {
    const f = await fixture(),
      before = f.snapshot();
    for (const bad of [
      sibling,
      "null",
      origin + ".evil.example",
      "http://storage.csrf-fixture.example",
      origin + "/path",
      origin + "?query=1",
      origin + "#fragment",
      "https://user@storage.csrf-fixture.example",
      origin + " " + sibling,
    ]) {
      expect(
        (await f.move({ origin: bad, "sec-fetch-site": "same-origin" })).status,
      ).toBe(403);
      expect(f.snapshot()).toEqual(before);
    }
  });
  test("origin normalization preserves case and default HTTPS port", async () => {
    const f = await fixture();
    expect(
      (await f.move({ origin: "https://STORAGE.CSRF-FIXTURE.EXAMPLE:443" }))
        .status,
    ).toBe(200);
  });
  test("portable callback delivery supplies the exact allowed origin without APP_URL", async () => {
    const f = await fixture({ portable: true }),
      before = f.snapshot();
    expect((await f.move({ origin: sibling })).status).toBe(403);
    expect(f.snapshot()).toEqual(before);
    expect((await f.move({ origin })).status).toBe(200);
  });
  test("the legacy Workspace path also requires a trusted mutation origin", async () => {
    const f = await fixture({ legacy: true }),
      before = f.snapshot();
    expect((await f.move({ origin: sibling })).status).toBe(403);
    expect(f.snapshot()).toEqual(before);
    expect((await f.move({ origin })).status).toBe(200);
  });
  test("normal-origin requests still revalidate current membership", async () => {
    const f = await fixture(),
      before = f.snapshot();
    f.member(false);
    const response = await f.move({ origin });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "app_membership_required" });
    expect(f.snapshot()).toEqual(before);
  });
  test("a trusted origin cannot bypass the source revision precondition", async () => {
    const f = await fixture();
    expect(
      (
        await f.send(
          "PUT",
          "/api/drive/file/source.txt",
          {
            origin,
            "if-match": f.etag,
          },
          "newer revision",
        )
      ).status,
    ).toBe(201);
    const before = f.snapshot();
    expect((await f.move({ origin })).status).toBe(412);
    expect(f.snapshot()).toEqual(before);
    expect(
      new TextDecoder().decode(f.bucket.objects.get("drive/source.txt")!.bytes),
    ).toBe("newer revision");
  });
  test("no Cookie remains unauthorized even when browser metadata is supplied", async () => {
    const f = await fixture(),
      before = f.snapshot();
    expect(
      (await f.move({ origin: sibling, "sec-fetch-site": "same-site" }, false))
        .status,
    ).toBe(401);
    expect(f.snapshot()).toEqual(before);
  });
  test("PUT and DELETE use the same gate before their conditional effects", async () => {
    const f = await fixture(),
      before = f.snapshot();
    expect(
      (
        await f.send(
          "PUT",
          "/api/drive/file/source.txt",
          { origin: sibling, "if-match": f.etag },
          "replacement",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.send("DELETE", "/api/drive/file/source.txt", {
          origin: sibling,
          "if-match": f.etag,
        })
      ).status,
    ).toBe(403);
    expect(f.snapshot()).toEqual(before);
  });
  test("public mode remains explicit and is outside the Cookie gate", async () => {
    const f = await fixture();
    f.env.ALLOW_UNAUTHENTICATED_DRIVE = "1";
    expect((await f.move({ origin: sibling }, false)).status).toBe(200);
  });
});
