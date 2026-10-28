// takos-secret-scan: synthetic — local issuer responses and session material only.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import worker from "./worker.ts";
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
            workspace_memberships: ["fixture-workspace"],
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
