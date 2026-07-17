/**
 * User-facing OIDC session auth for the workspace drive surface.
 *
 * A dependency-free port of the ecosystem app-auth pattern (Takosumi
 * Accounts authorization-code + PKCE, HMAC-sealed cookies) for a plain
 * fetch-handler Worker. Auth is OFF unless APP_AUTH_REQUIRED is set, so a
 * bare self-host apply stays usable; when on, the drive UI and /api/drive
 * routes require a signed session cookie, and — when APP_WORKSPACE_ID is set —
 * membership of that workspace.
 *
 * The `/o` object API is NOT covered here: runtime consumers use Interface
 * OAuth credentials independently of browser sessions.
 */

import type { Env } from "./types.ts";

const SESSION_COOKIE = "takos_app_session";
const STATE_COOKIE = "takos_app_oauth_state";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;

export interface AppSession {
  sub: string;
  name?: string;
  workspaceIds: string[];
  exp: number;
}

type OAuthState = {
  state: string;
  codeVerifier: string;
  returnTo: string;
  exp: number;
};

function envValue(env: Env, name: keyof Env): string | undefined {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function appAuthRequired(env: Env): boolean {
  const value = envValue(env, "APP_AUTH_REQUIRED");
  return value ? ["1", "true", "yes"].includes(value.toLowerCase()) : false;
}

function authConfig(env: Env) {
  return {
    required: appAuthRequired(env),
    issuer: envValue(env, "OIDC_ISSUER_URL"),
    clientId: envValue(env, "OIDC_CLIENT_ID"),
    clientSecret: envValue(env, "OIDC_CLIENT_SECRET"),
    sessionSecret: envValue(env, "APP_SESSION_SECRET"),
    workspaceId: envValue(env, "APP_WORKSPACE_ID"),
  };
}

function authMissing(env: Env): string[] {
  const config = authConfig(env);
  if (!config.required) return [];
  const requiredValues: Array<[string, string | undefined]> = [
    ["OIDC_ISSUER_URL", config.issuer],
    ["OIDC_CLIENT_ID", config.clientId],
    ["APP_SESSION_SECRET", config.sessionSecret],
  ];
  return requiredValues.flatMap(([name, value]) => (value ? [] : [name]));
}

export function appAuthMisconfigured(env: Env): Response | null {
  const missing = authMissing(env);
  if (missing.length === 0) return null;
  return Response.json(
    { error: "app_auth_not_configured", missing },
    { status: 503 },
  );
}

// ---- Sealed cookies (HMAC-SHA256, purpose-bound) ----------------------------

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    const padded = value
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(signature));
}

/**
 * Constant-time string comparison via fixed-length SHA-256 digests, so
 * neither length nor first-difference position leaks through timing.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(a)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(b)),
  ]);
  const ba = new Uint8Array(da);
  const bb = new Uint8Array(db);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < ba.length && i < bb.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// `purpose` is mixed into the signed material so an OAuth `state` cookie can
// never be replayed as a `session` cookie even though both share the secret.
export async function seal(
  value: unknown,
  secret: string,
  purpose: string,
): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(value)));
  return `${payload}.${await sign(`${purpose}.${payload}`, secret)}`;
}

export async function unseal<T>(
  token: string,
  secret: string,
  purpose: string,
): Promise<T | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await sign(`${purpose}.${payload}`, secret);
  if (!(await timingSafeEqual(expected, signature))) return null;
  return parseBase64UrlJson<T>(payload);
}

function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return base64Url(new Uint8Array(digest));
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=") || null;
  }
  return null;
}

function cookieHeader(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---- Open-redirect-safe return_to -------------------------------------------

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeReturnTo(value: string | null): string {
  // Only a same-origin local path may drive the post-login redirect (reject
  // `//host`, backslash tricks, and control characters).
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || hasControlChar(value)) return "/";
  try {
    const base = "https://app.invalid";
    const u = new URL(value, base);
    if (u.origin !== base) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  return new URL(
    "/api/auth/callback/takos",
    `${url.protocol}//${url.host}`,
  ).toString();
}

// ---- OIDC flow ---------------------------------------------------------------

async function exchangeCode(
  env: Env,
  request: Request,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const config = authConfig(env);
  const tokenEndpoint = `${config.issuer!.replace(/\/$/, "")}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId!,
    redirect_uri: callbackUrl(request),
    code_verifier: codeVerifier,
  });
  // PKCE public clients have no secret; send one only when configured.
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status}`);
  const payload = (await res.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("OAuth token response missing access_token");
  }
  return payload.access_token;
}

function normalizeWorkspaceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() !== "") {
      seen.add(entry);
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const candidate = record.workspace_id;
      if (typeof candidate === "string" && candidate.trim() !== "") {
        seen.add(candidate);
      }
    }
  }
  return [...seen];
}

async function fetchUserInfo(env: Env, accessToken: string) {
  const config = authConfig(env);
  const userinfoEndpoint = `${config.issuer!.replace(/\/$/, "")}/oauth/userinfo`;
  const res = await fetch(userinfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`OAuth userinfo failed: ${res.status}`);
  const body = (await res.json()) as {
    user?: { id?: string; name?: string };
    sub?: string;
    name?: string;
    workspace_memberships?: unknown;
    takosumi?: { workspace_id?: unknown };
  };
  const sub = body.user?.id ?? body.sub;
  if (!sub) throw new Error("OAuth userinfo response missing subject");
  const workspaceIds = normalizeWorkspaceIds(body.workspace_memberships);
  const nestedWorkspaceId = body.takosumi?.workspace_id;
  if (
    typeof nestedWorkspaceId === "string" &&
    nestedWorkspaceId.trim() !== "" &&
    !workspaceIds.includes(nestedWorkspaceId)
  ) {
    workspaceIds.push(nestedWorkspaceId);
  }
  return { sub, name: body.user?.name ?? body.name, workspaceIds };
}

// ---- Guard + session lookup --------------------------------------------------

export async function getAppSession(
  env: Env,
  request: Request,
): Promise<AppSession | null> {
  const config = authConfig(env);
  if (!config.sessionSecret) return null;
  const raw = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!raw) return null;
  const session = await unseal<AppSession>(
    raw,
    config.sessionSecret,
    "session",
  );
  if (
    !session ||
    typeof session.sub !== "string" ||
    session.sub === "" ||
    typeof session.exp !== "number" ||
    session.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return session;
}

/** Null when the request may proceed; otherwise the 401/403/503 to return. */
export async function requireAppAuth(
  env: Env,
  request: Request,
): Promise<Response | null> {
  const config = authConfig(env);
  if (!config.required) return null;
  const misconfigured = appAuthMisconfigured(env);
  if (misconfigured) return misconfigured;
  const session = await getAppSession(env, request);
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (config.workspaceId) {
    const memberships = Array.isArray(session.workspaceIds)
      ? session.workspaceIds
      : [];
    if (!memberships.includes(config.workspaceId)) {
      return Response.json(
        { error: "workspace_membership_required" },
        { status: 403 },
      );
    }
  }
  return null;
}

// ---- Routes ------------------------------------------------------------------

/** Handles /api/auth/*; null when the request is not an auth route. */
export async function handleAuthRoute(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const config = authConfig(env);

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    if (!config.required) return Response.json({ required: false });
    const misconfigured = appAuthMisconfigured(env);
    if (misconfigured) return misconfigured;
    const session = await getAppSession(env, request);
    if (!session)
      return Response.json({ error: "unauthorized" }, { status: 401 });
    if (
      config.workspaceId &&
      !session.workspaceIds?.includes(config.workspaceId)
    ) {
      return Response.json(
        { error: "workspace_membership_required" },
        { status: 403 },
      );
    }
    return Response.json({
      required: true,
      sub: session.sub,
      name: session.name ?? null,
    });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearCookie(SESSION_COOKIE),
      },
    });
  }

  if (url.pathname === "/api/auth/login" && request.method === "GET") {
    const misconfigured = appAuthMisconfigured(env);
    if (misconfigured) return misconfigured;
    if (!config.required) {
      return Response.redirect(new URL("/", url).toString(), 302);
    }
    const codeVerifier = randomToken();
    const state: OAuthState = {
      state: randomToken(),
      codeVerifier,
      returnTo: safeReturnTo(url.searchParams.get("return_to")),
      exp: Math.floor(Date.now() / 1000) + STATE_MAX_AGE_SECONDS,
    };
    const authUrl = new URL(
      `${config.issuer!.replace(/\/$/, "")}/oauth/authorize`,
    );
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", config.clientId!);
    authUrl.searchParams.set("redirect_uri", callbackUrl(request));
    authUrl.searchParams.set("scope", "openid profile email");
    authUrl.searchParams.set("state", state.state);
    authUrl.searchParams.set(
      "code_challenge",
      await sha256Base64Url(codeVerifier),
    );
    authUrl.searchParams.set("code_challenge_method", "S256");
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        "Set-Cookie": cookieHeader(
          request,
          STATE_COOKIE,
          await seal(state, config.sessionSecret!, "state"),
          STATE_MAX_AGE_SECONDS,
        ),
      },
    });
  }

  if (url.pathname === "/api/auth/callback/takos" && request.method === "GET") {
    const misconfigured = appAuthMisconfigured(env);
    if (misconfigured) return misconfigured;
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const stateCookie = parseCookie(
      request.headers.get("Cookie"),
      STATE_COOKIE,
    );
    const state = stateCookie
      ? await unseal<OAuthState>(stateCookie, config.sessionSecret!, "state")
      : null;
    if (
      !code ||
      !returnedState ||
      !state ||
      state.state !== returnedState ||
      state.exp <= Math.floor(Date.now() / 1000)
    ) {
      return Response.json({ error: "invalid_oauth_state" }, { status: 400 });
    }
    const accessToken = await exchangeCode(
      env,
      request,
      code,
      state.codeVerifier,
    );
    const user = await fetchUserInfo(env, accessToken);
    const session = await seal(
      {
        sub: user.sub,
        name: user.name,
        workspaceIds: user.workspaceIds,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      } satisfies AppSession,
      config.sessionSecret!,
      "session",
    );
    // Re-validate at emit time so a tampered/legacy state cookie can never
    // drive an external Location redirect.
    const headers = new Headers({ Location: safeReturnTo(state.returnTo) });
    headers.append("Set-Cookie", clearCookie(STATE_COOKIE));
    headers.append(
      "Set-Cookie",
      cookieHeader(request, SESSION_COOKIE, session, SESSION_MAX_AGE_SECONDS),
    );
    return new Response(null, { status: 302, headers });
  }

  return null;
}
