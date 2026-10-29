// takos-secret-scan: synthetic — local issuer responses and session material only.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import worker from "./worker.ts";
import { seal } from "./app-auth.ts";
import type { Env, R2Bucket } from "./types.ts";

const redirect = "https://installed-storage.example/api/auth/callback/takos";
const issuer = "https://accounts.example";
const bucket: R2Bucket = {
  async get() {
    return null;
  },
  async put() {
    throw new Error("unexpected write");
  },
  async delete() {
    throw new Error("unexpected delete");
  },
  async list() {
    return { objects: [], truncated: false };
  },
};
const env: Env = {
  BUCKET: bucket,
  OIDC_ISSUER_URL: issuer,
  OIDC_CLIENT_ID: "fixture-client",
  OIDC_OWNER_SUB: "fixture-owner",
  OIDC_REDIRECT_URI: redirect,
  APP_SESSION_SECRET: "synthetic-fixture-session-secret-32-bytes",
};
let restoreFetch: (() => void) | undefined;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

function req(path: string, cookie?: string) {
  return new Request(`https://untrusted-request-host.example${path}`, {
    headers: cookie ? { cookie } : {},
  });
}
function cookie(response: Response, name: string): string {
  const line = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
  expect(line).toBeDefined();
  return line!.split(";", 1)[0]!;
}
async function loginAndCallback(
  subject = "fixture-owner",
  overrides: Partial<Env> = {},
  claims: Record<string, unknown> = {
    workspace_memberships: ["fixture-workspace"],
  },
) {
  const config = { ...env, ...overrides };
  const login = await worker.fetch(
    req("/api/auth/login?return_to=%2Fui"),
    config,
  );
  expect(login.status).toBe(302);
  const authorization = new URL(login.headers.get("location")!);
  expect(authorization.origin).toBe(issuer);
  expect(authorization.searchParams.get("redirect_uri")).toBe(redirect);
  expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
  const calls: string[] = [];
  restoreFetch?.();
  restoreFetch = undefined;
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url === `${issuer}/oauth/token`) {
          const body = new URLSearchParams(String(init?.body));
          expect(body.get("redirect_uri")).toBe(redirect);
          expect(body.get("client_id")).toBe("fixture-client");
          expect(body.get("code")).toBe("fixture-code");
          const digest = new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(body.get("code_verifier")!),
            ),
          );
          const challenge = btoa(String.fromCharCode(...digest))
            .replaceAll("+", "-")
            .replaceAll("/", "_")
            .replaceAll("=", "");
          expect(challenge).toBe(
            authorization.searchParams.get("code_challenge")!,
          );
          return Response.json({ access_token: "synthetic-fixture-access" });
        }
        if (url === `${issuer}/oauth/userinfo`) {
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer synthetic-fixture-access",
          );
          return Response.json({
            sub: subject,
            ...claims,
          });
        }
        throw new Error("unexpected network request");
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  restoreFetch = () => fetchMock.mockRestore();
  const state = authorization.searchParams.get("state")!;
  const stateCookie = cookie(login, "takos_app_oauth_state");
  const response = await worker.fetch(
    req(
      `/api/auth/callback/takos?code=fixture-code&state=${encodeURIComponent(state)}`,
      stateCookie,
    ),
    config,
  );
  return { config, response, state, stateCookie, calls };
}

describe("portable registered OIDC runtime inputs", () => {
  test("real PKCE callback creates a session, restores on reload and authorizes Drive", async () => {
    const { config, response, calls } = await loginAndCallback();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/ui");
    expect(calls).toEqual([
      `${issuer}/oauth/token`,
      `${issuer}/oauth/userinfo`,
    ]);
    const session = cookie(response, "takos_app_session");
    const me = await worker.fetch(req("/api/auth/me", session), config);
    expect(me.status).toBe(200);
    expect(((await me.json()) as { sub: string }).sub).toBe("fixture-owner");
    expect(
      (await worker.fetch(req("/api/drive/list", session), { ...config }))
        .status,
    ).toBe(200);
    expect(
      (await worker.fetch(req("/api/drive/list", session + "tamper"), config))
        .status,
    ).toBe(401);
    expect(
      (
        await worker.fetch(req("/api/drive/list", session), {
          ...config,
          APP_SESSION_SECRET: "other-capsule-synthetic-secret",
        })
      ).status,
    ).toBe(401);
  });

  test("registration metadata does not restrict another legitimate Workspace member", async () => {
    const { config, response } = await loginAndCallback("different-member", {
      APP_WORKSPACE_ID: "fixture-workspace",
    });
    expect(response.status).toBe(302);
    const session = cookie(response, "takos_app_session");
    expect(
      (await worker.fetch(req("/api/auth/me", session), config)).status,
    ).toBe(200);
    expect(
      (await worker.fetch(req("/api/drive/list", session), config)).status,
    ).toBe(200);
    expect(
      (
        await worker.fetch(req("/api/drive/list", session), {
          ...config,
          APP_WORKSPACE_ID: "different-workspace",
        })
      ).status,
    ).toBe(403);
    expect((await worker.fetch(req("/api/drive/list"), config)).status).toBe(
      401,
    );
  });

  test.each(["", " ", "\t"])(
    "configured blank redirect %j never falls back to valid APP_URL",
    async (value) => {
      const response = await worker.fetch(req("/api/auth/login"), {
        ...env,
        APP_URL: "https://installed-storage.example",
        OIDC_REDIRECT_URI: value,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "app_auth_not_configured",
        invalid: ["OIDC_REDIRECT_URI"],
      });
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  test("missing origin or secret stays unavailable, configured no-cookie stays unauthorized", async () => {
    expect(
      (
        await worker.fetch(req("/api/auth/me"), {
          ...env,
          OIDC_REDIRECT_URI: undefined,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await worker.fetch(req("/api/auth/me"), {
          ...env,
          APP_SESSION_SECRET: undefined,
        })
      ).status,
    ).toBe(503);
    expect((await worker.fetch(req("/api/auth/me"), env)).status).toBe(401);
  });

  test.each([
    "http://installed-storage.example/api/auth/callback/takos",
    "https://user@installed-storage.example/api/auth/callback/takos",
    "https://installed-storage.example/other",
    `${redirect}?extra=1`,
    `${redirect}#fragment`,
    "https://installed-storage.example/api/auth/%63allback/takos",
    "https://installed-storage.example/other/../api/auth/callback/takos",
    ` ${redirect}`,
    "not a URL",
  ])("refuses invalid registered redirect %s before OAuth", async (value) => {
    const response = await worker.fetch(req("/api/auth/login"), {
      ...env,
      OIDC_REDIRECT_URI: value,
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });

  test("refuses disagreement with explicit APP_URL and accepts the same canonical origin", async () => {
    expect(
      (
        await worker.fetch(req("/api/auth/login"), {
          ...env,
          APP_URL: "https://different.example",
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await worker.fetch(req("/api/auth/login"), {
          ...env,
          APP_URL: "https://installed-storage.example/",
        })
      ).status,
    ).toBe(302);
  });

  test.each([
    "http://installed-storage.example",
    "https://installed-storage.example/path",
  ])(
    "reports invalid explicit APP_URL %s without blaming valid delivery",
    async (value) => {
      const response = await worker.fetch(req("/api/auth/login"), {
        ...env,
        APP_URL: value,
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "app_auth_not_configured",
        invalid: ["APP_URL"],
      });
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  test("callback rejects tampered and expired state without token exchange", async () => {
    const login = await worker.fetch(req("/api/auth/login"), env);
    const state = new URL(login.headers.get("location")!).searchParams.get(
      "state",
    )!;
    const stateCookie = cookie(login, "takos_app_oauth_state");
    const callback = `/api/auth/callback/takos?code=fixture-code&state=${encodeURIComponent(state)}`;
    const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        () => {
          throw new Error("must not fetch");
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    restoreFetch = () => fetchMock.mockRestore();
    expect(
      (await worker.fetch(req(callback, stateCookie + "tamper"), env)).status,
    ).toBe(400);
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now + 601_000);
    try {
      expect((await worker.fetch(req(callback, stateCookie), env)).status).toBe(
        400,
      );
    } finally {
      clock.mockRestore();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("installed app sign-in claims", () => {
  const appEnv = {
    APP_CAPSULE_ID: "fixture-app",
    APP_WORKSPACE_ID: "fixture-workspace",
  };

  test.each(["owner", "member", undefined])(
    "matching app with role %s signs in but private Drive requires a live role",
    async (appRole) => {
      const { config, response } = await loginAndCallback(
        "ordinary-signed-in-user",
        appEnv,
        { takosumi: { capsule_id: "fixture-app", app_role: appRole } },
      );
      expect(response.status).toBe(302);
      const session = cookie(response, "takos_app_session");
      const me = await worker.fetch(req("/api/auth/me", session), config);
      expect(me.status).toBe(200);
      // A previously issued owner/member claim may have been revoked. /me
      // must never publish that cached snapshot as current management authority.
      expect(await me.json()).toEqual({
        required: true,
        sub: "ordinary-signed-in-user",
        name: null,
        authenticated: true,
      });
      expect(
        (await worker.fetch(req("/api/drive/list", session), config)).status,
      ).toBe(appRole ? 200 : 403);
      // Existing sessions cannot carry app management or Drive access into
      // another installation, even if the compatibility Workspace is the same.
      for (const path of ["/api/auth/me", "/api/drive/list"]) {
        const changed = await worker.fetch(req(path, session), {
          ...config,
          APP_CAPSULE_ID: "another-app",
        });
        expect(changed.status).toBe(401);
        expect(await changed.json()).toEqual({ error: "unauthorized" });
      }
    },
  );

  test.each(["administrator", "OWNER", "", null, 1])(
    "invalid app role %s never becomes ordinary or management access",
    async (appRole) => {
      const { response } = await loginAndCallback("fixture-user", appEnv, {
        workspace_memberships: ["fixture-workspace"],
        takosumi: { capsule_id: "fixture-app", app_role: appRole },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "invalid_app_claim" });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  test.each([
    { capsule_id: "another-app", app_role: "owner" },
    { capsule_id: "another-app" },
    { app_role: "owner" },
    { capsule_id: "", app_role: "member" },
    { capsule_id: null },
  ])(
    "app claim %j cannot fall back to Workspace membership",
    async (claims) => {
      const { response } = await loginAndCallback("fixture-user", appEnv, {
        workspace_memberships: ["fixture-workspace"],
        takosumi: claims,
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  test.each([null, false, "malformed", []].map((takosumi) => ({ takosumi })))(
    "malformed app claim envelope %j fails closed",
    async ({ takosumi }) => {
      const { response } = await loginAndCallback("fixture-user", appEnv, {
        workspace_memberships: ["fixture-workspace"],
        takosumi,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "invalid_app_claim" });
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  test("app browser sessions need no compatibility Workspace configuration", async () => {
    const { config, response } = await loginAndCallback(
      "ordinary-user",
      { APP_CAPSULE_ID: "fixture-app" },
      { takosumi: { capsule_id: "fixture-app" } },
    );
    expect(response.status).toBe(302);
    const session = cookie(response, "takos_app_session");
    expect(
      (await worker.fetch(req("/api/auth/me", session), config)).status,
    ).toBe(200);
    expect(
      (await worker.fetch(req("/api/drive/list", session), config)).status,
    ).toBe(403);
  });

  test("an unconfigured expected app ignores claimed app authority", async () => {
    const { response } = await loginAndCallback(
      "fixture-user",
      {},
      {
        takosumi: { capsule_id: "fixture-app", app_role: "owner" },
      },
    );
    expect(response.status).toBe(302);
  });

  test("legacy Workspace claim forms keep access without granting an app role", async () => {
    for (const claims of [
      { workspace_memberships: ["fixture-workspace"] },
      { workspace_memberships: [{ workspace_id: "fixture-workspace" }] },
      { takosumi: { workspace_id: "fixture-workspace", role: "owner" } },
    ]) {
      const { config, response } = await loginAndCallback(
        "fixture-user",
        { APP_WORKSPACE_ID: "fixture-workspace" },
        claims,
      );
      expect(response.status).toBe(302);
      const session = cookie(response, "takos_app_session");
      const me = await worker.fetch(req("/api/auth/me", session), config);
      expect(me.status).toBe(200);
      expect(
        ((await me.json()) as { appRole: unknown }).appRole,
      ).toBeUndefined();
      expect(
        (await worker.fetch(req("/api/drive/list", session), config)).status,
      ).toBe(200);
    }
  });

  test("sealed invalid roles cannot bypass the shared session and Drive guard", async () => {
    const session = `takos_app_session=${await seal(
      {
        sub: "fixture-user",
        capsuleId: "fixture-app",
        appRole: "administrator",
        workspaceIds: ["fixture-workspace"],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      env.APP_SESSION_SECRET!,
      "session",
    )}`;
    for (const path of ["/api/auth/me", "/api/drive/list"]) {
      expect(
        (await worker.fetch(req(path, session), { ...env, ...appEnv })).status,
      ).toBe(403);
    }
  });
});

describe("legacy install context compatibility", () => {
  test("capsule-bound current Accounts claims work without APP_CAPSULE_ID", async () => {
    const { config, response } = await loginAndCallback(
      "fixture-user",
      {
        APP_WORKSPACE_ID: "fixture-workspace",
      },
      {
        workspace_memberships: ["fixture-workspace"],
        takosumi: {
          capsule_id: "fixture-app",
          workspace_id: "fixture-workspace",
          role: "member",
        },
      },
    );
    expect(response.status).toBe(302);
    const session = cookie(response, "takos_app_session");
    expect(
      (await worker.fetch(req("/api/drive/list", session), config)).status,
    ).toBe(200);
  });

  test.each([
    {},
    { takosumi: { workspace_id: "fixture-workspace", role: "owner" } },
  ])(
    "configured Capsule refuses UserInfo without app claims: %j",
    async (claims) => {
      const { response } = await loginAndCallback(
        "fixture-user",
        {
          APP_CAPSULE_ID: "fixture-app",
        },
        claims,
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );
});
