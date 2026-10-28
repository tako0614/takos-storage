// takos-secret-scan: synthetic — local issuer, encrypted test tokens and bucket only.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import worker from "./worker.ts";
import { getAppSession, seal } from "./app-auth.ts";
import type { Env } from "./types.ts";

const origin = "https://storage.example";
const issuer = "https://accounts.example";
const token = "synthetic-private-drive-access-token";
let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

function cookie(response: Response, name: string): string {
  const value = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${name}=`));
  expect(value).toBeDefined();
  return value!.split(";", 1)[0]!;
}

async function fixture(role: "owner" | "member" | undefined) {
  const effects: string[] = [];
  const env: Env = {
    APP_URL: origin,
    OIDC_ISSUER_URL: issuer,
    OIDC_CLIENT_ID: "fixture-client",
    APP_SESSION_SECRET: "synthetic-private-drive-secret",
    APP_CAPSULE_ID: "app-storage",
    APP_WORKSPACE_ID: "legacy-workspace",
    BUCKET: {
      async get(key) {
        effects.push("get");
        return {
          key,
          size: 6,
          uploaded: new Date(0),
          body: new Response("secret").body!,
          arrayBuffer: async () => new TextEncoder().encode("secret").buffer,
        };
      },
      async list() {
        effects.push("list");
        return { objects: [], truncated: false };
      },
      async put(key) {
        effects.push("put");
        return {
          key,
          size: 3,
          uploaded: new Date(0),
          httpEtag: '"revision"',
          body: new Response("new").body!,
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
      async delete() {
        effects.push("delete");
      },
    },
  };
  let current: Record<string, unknown> = {
    sub: "same-user",
    workspace_memberships: ["legacy-workspace"],
    takosumi: { capsule_id: "app-storage", app_role: role },
  };
  let status = 200;
  const calls: string[] = [];
  restoreFetch?.();
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url === `${issuer}/oauth/token`)
          return Response.json({ access_token: token });
        if (url === `${issuer}/oauth/userinfo`) {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            `Bearer ${token}`,
          );
          return Response.json(current, { status });
        }
        throw new Error("unexpected request");
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  restoreFetch = () => fetchMock.mockRestore();
  const login = await worker.fetch(
    new Request(`${origin}/api/auth/login`),
    env,
  );
  const state = new URL(login.headers.get("location")!).searchParams.get(
    "state",
  )!;
  const callback = await worker.fetch(
    new Request(
      `${origin}/api/auth/callback/takos?code=fixture-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: cookie(login, "takos_app_oauth_state") } },
    ),
    env,
  );
  expect(callback.status).toBe(302);
  const session = cookie(callback, "takos_app_session");
  const request = (path: string, method = "GET", config: Env = env) =>
    worker.fetch(
      new Request(`${origin}${path}`, {
        method,
        headers: {
          cookie: session,
          "if-none-match": "*",
          "content-type": "text/plain",
        },
        ...(method === "PUT" || method === "POST" ? { body: "new" } : {}),
      }),
      config,
    );
  return {
    env,
    effects,
    calls,
    callback,
    session,
    request,
    evidence: (value: Record<string, unknown>) => {
      current = value;
    },
    status: (value: number) => {
      status = value;
    },
  };
}

const privateOperations = [
  ["/api/drive/list", "GET"],
  ["/api/drive/file/private.txt", "GET"],
  ["/api/drive/file/private.txt", "HEAD"],
  ["/api/drive/file/private.txt", "PUT"],
  ["/api/drive/file/private.txt", "DELETE"],
  ["/api/drive/move", "POST"],
] as const;

describe("private shared Drive admission", () => {
  test("ordinary matching-app sign-in authenticates without read or mutation access", async () => {
    const f = await fixture(undefined);
    const me = await f.request("/api/auth/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ sub: "same-user" });
    for (const [path, method] of privateOperations) {
      const response = await f.request(path, method);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "app_membership_required",
      });
    }
    expect(f.effects).toEqual([]);
  });

  test.each(["owner", "member"] as const)(
    "current %s can read and write the private Drive",
    async (role) => {
      const f = await fixture(role);
      expect((await f.request("/api/drive/list")).status).toBe(200);
      const read = await f.request("/api/drive/file/private.txt");
      expect(read.status).toBe(200);
      expect(await read.text()).toBe("secret");
      expect((await f.request("/api/drive/file/new.txt", "PUT")).status).toBe(
        201,
      );
      expect(f.effects).toEqual(["list", "get", "put"]);
      expect(
        f.calls.filter((url) => url.endsWith("/oauth/userinfo")),
      ).toHaveLength(4);
    },
  );

  test("removing current membership denies the same previously admitted cookie", async () => {
    const f = await fixture("owner");
    expect((await f.request("/api/drive/list")).status).toBe(200);
    f.effects.length = 0;
    f.evidence({
      sub: "same-user",
      workspace_memberships: ["legacy-workspace"],
      takosumi: { capsule_id: "app-storage" },
    });
    expect((await f.request("/api/auth/me")).status).toBe(200);
    for (const [path, method] of privateOperations)
      expect((await f.request(path, method)).status).toBe(403);
    expect(f.effects).toEqual([]);
  });

  test("live foreign Capsule, changed subject, malformed role and legacy fallback all deny", async () => {
    const f = await fixture("member");
    for (const claims of [
      {
        sub: "same-user",
        takosumi: { capsule_id: "foreign-app", app_role: "owner" },
      },
      {
        sub: "other-user",
        takosumi: { capsule_id: "app-storage", app_role: "owner" },
      },
      {
        sub: "same-user",
        takosumi: { capsule_id: "app-storage", app_role: "admin" },
      },
      {
        sub: "same-user",
        takosumi: { workspace_id: "legacy-workspace", role: "owner" },
      },
    ]) {
      f.evidence({ workspace_memberships: ["legacy-workspace"], ...claims });
      for (const [path, method] of privateOperations)
        expect((await f.request(path, method)).status).toBe(403);
    }
    f.status(401);
    expect((await f.request("/api/drive/list")).status).toBe(403);
    expect(f.effects).toEqual([]);
  });

  test("modern token stays encrypted, bound to its app context and absent from identity output", async () => {
    const f = await fixture("owner");
    const value = f.session.slice(f.session.indexOf("=") + 1);
    expect(value.startsWith("v2.")).toBe(true);
    expect(value).not.toContain(token);
    const identity = await getAppSession(
      f.env,
      new Request(origin, { headers: { cookie: f.session } }),
    );
    expect(identity).not.toHaveProperty("accessToken");
    for (const overrides of [
      { APP_CAPSULE_ID: "foreign-app" },
      { OIDC_ISSUER_URL: "https://other-accounts.example" },
      { OIDC_CLIENT_ID: "other-client" },
    ])
      expect(
        (await f.request("/api/drive/list", "GET", { ...f.env, ...overrides }))
          .status,
      ).toBe(401);
    const index = f.session.indexOf("v2.") + 6;
    const tampered =
      f.session.slice(0, index) +
      (f.session[index] === "A" ? "z" : "A") +
      f.session.slice(index + 1);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/drive/list`, {
            headers: { cookie: tampered },
          }),
          f.env,
        )
      ).status,
    ).toBe(401);
  });

  test("HMAC app-role cookies cannot supply a plaintext token or cached authority", async () => {
    const f = await fixture("owner");
    const raw = await seal(
      {
        sub: "same-user",
        capsuleId: "app-storage",
        appRole: "owner",
        accessToken: token,
        workspaceIds: ["legacy-workspace"],
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      f.env.APP_SESSION_SECRET!,
      "session",
    );
    const response = await worker.fetch(
      new Request(`${origin}/api/drive/list`, {
        headers: { cookie: `takos_app_session=${raw}` },
      }),
      f.env,
    );
    expect(response.status).toBe(403);
    expect(f.effects).toEqual([]);
  });

  test("explicit public opt-in still allows unauthenticated data access", async () => {
    const f = await fixture(undefined);
    const publicEnv = { ...f.env, ALLOW_UNAUTHENTICATED_DRIVE: "1" };
    expect(
      (await worker.fetch(new Request(`${origin}/api/drive/list`), publicEnv))
        .status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(
          new Request(`${origin}/api/drive/file/new.txt`, {
            method: "PUT",
            headers: { "if-none-match": "*" },
            body: "new",
          }),
          publicEnv,
        )
      ).status,
    ).toBe(201);
  });
});
