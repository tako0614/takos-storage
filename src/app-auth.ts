/**
 * User-facing OIDC session auth for the installed app drive surface.
 *
 * A dependency-free port of the ecosystem app-auth pattern (Takosumi
 * Accounts authorization-code + PKCE, HMAC-sealed cookies) for a plain
 * fetch-handler Worker. Auth is ON by default: the drive UI and /api/drive
 * routes require a signed session cookie. App claims must match APP_CAPSULE_ID;
 * sign-in accepts ordinary users, but the shared private Drive requires current
 * owner/member status revalidated through UserInfo for each request. Cached
 * role snapshots never authorize data access. Legacy sessions still honor
 * APP_WORKSPACE_ID.
 * An install that omits the Accounts wiring
 * fails loudly with 503 (see appAuthMisconfigured) instead of serving the
 * drive anonymously; a deliberately public drive takes the explicit
 * ALLOW_UNAUTHENTICATED_DRIVE opt-in.
 *
 * The `/o` object API is NOT covered here: runtime consumers use Interface
 * OAuth credentials independently of browser sessions.
 */

import type { Env } from "./types.ts";

const SESSION_COOKIE = "takos_app_session";
const STATE_COOKIE = "takos_app_oauth_state";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const STATE_MAX_AGE_SECONDS = 10 * 60;
const MAX_SESSION_COOKIE_VALUE_BYTES = 3_800;

export type AppRole = "owner" | "member";

export interface AppSession {
  sub: string;
  name?: string;
  workspaceIds: string[];
  capsuleId?: string;
  appRole?: AppRole;
  exp: number;
}

type StoredAppSession = AppSession & { accessToken?: string };

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

/**
 * Fail closed: a missing or unparsable flag must never be read as "the drive
 * is public", so only an explicit affirmative opt-in drops the session gate.
 */
export function appAuthRequired(env: Env): boolean {
  const value = envValue(env, "ALLOW_UNAUTHENTICATED_DRIVE");
  return !(value && ["1", "true", "yes"].includes(value.toLowerCase()));
}

function authConfig(env: Env) {
  return {
    required: appAuthRequired(env),
    appUrl: envValue(env, "APP_URL"),
    redirectUri: env.OIDC_REDIRECT_URI,
    issuer: envValue(env, "OIDC_ISSUER_URL"),
    clientId: envValue(env, "OIDC_CLIENT_ID"),
    clientSecret: envValue(env, "OIDC_CLIENT_SECRET"),
    sessionSecret: envValue(env, "APP_SESSION_SECRET"),
    workspaceId: envValue(env, "APP_WORKSPACE_ID"),
    capsuleId: envValue(env, "APP_CAPSULE_ID"),
  };
}

function canonicalBareHttpsOrigin(
  value: string | undefined,
  name: "APP_URL" | "OIDC_ISSUER_URL",
): string {
  if (!value) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a bare HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${name} must be a bare HTTPS origin`);
  }
  return url.origin;
}

function authMissing(env: Env): string[] {
  const config = authConfig(env);
  if (!config.required) return [];
  const requiredValues: Array<[string, string | undefined]> = [
    ["OIDC_ISSUER_URL", config.issuer],
    ["OIDC_CLIENT_ID", config.clientId],
    ["APP_SESSION_SECRET", config.sessionSecret],
  ];
  const missing = requiredValues.flatMap(([name, value]) =>
    value ? [] : [name],
  );
  if (!config.appUrl && config.redirectUri === undefined)
    missing.unshift("APP_URL");
  return missing;
}

export function appAuthMisconfigured(env: Env): Response | null {
  const missing = authMissing(env);
  if (missing.length > 0) {
    return Response.json(
      { error: "app_auth_not_configured", missing },
      { status: 503 },
    );
  }
  if (!appAuthRequired(env)) return null;
  const config = authConfig(env);
  const invalid: string[] = [];
  for (const [name, value] of [["OIDC_ISSUER_URL", config.issuer]] as const) {
    try {
      canonicalBareHttpsOrigin(value, name);
    } catch {
      invalid.push(name);
    }
  }
  if (config.appUrl !== undefined) {
    try {
      canonicalBareHttpsOrigin(config.appUrl, "APP_URL");
    } catch {
      invalid.push("APP_URL");
    }
  }
  if (!invalid.includes("APP_URL")) {
    try {
      callbackUrl(env);
    } catch {
      invalid.push(
        config.redirectUri !== undefined ? "OIDC_REDIRECT_URI" : "APP_URL",
      );
    }
  }
  return invalid.length > 0
    ? Response.json(
        { error: "app_auth_not_configured", invalid },
        { status: 503 },
      )
    : null;
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

// Modern app sessions retain the token only inside authenticated encryption.
// Legacy purpose-bound HMAC cookies remain readable without acquiring app roles.
function sessionContext(env: Env): ArrayBuffer {
  const config = authConfig(env);
  return new TextEncoder().encode(
    JSON.stringify([
      "takos-storage-session-v2",
      config.issuer,
      config.clientId,
      config.capsuleId,
    ]),
  ).buffer;
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`takos-storage-session-v2:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function sealAppSession(
  session: StoredAppSession,
  env: Env,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: sessionContext(env) },
    await sessionKey(authConfig(env).sessionSecret!),
    new TextEncoder().encode(JSON.stringify(session)),
  );
  const bytes = new Uint8Array(iv.length + ciphertext.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(ciphertext), iv.length);
  return `v2.${base64Url(bytes)}`;
}

async function openAppSession(
  raw: string,
  env: Env,
): Promise<StoredAppSession | null> {
  try {
    const encoded = raw.slice(3).replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(0, 12),
        additionalData: sessionContext(env),
      },
      await sessionKey(authConfig(env).sessionSecret!),
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as StoredAppSession;
  } catch {
    return null;
  }
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

function callbackUrl(env: Env): string {
  const config = authConfig(env);
  if (config.redirectUri !== undefined) {
    const url = new URL(config.redirectUri);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/api/auth/callback/takos" ||
      url.search ||
      url.hash ||
      config.redirectUri !== url.href ||
      url.href !== `${url.origin}/api/auth/callback/takos` ||
      (config.appUrl &&
        canonicalBareHttpsOrigin(config.appUrl, "APP_URL") !== url.origin)
    ) {
      throw new Error(
        "OIDC_REDIRECT_URI must match the registered HTTPS app callback",
      );
    }
    return url.href;
  }
  const origin = canonicalBareHttpsOrigin(config.appUrl, "APP_URL");
  return new URL("/api/auth/callback/takos", origin).toString();
}

function issuerUrl(env: Env, path: string): string {
  const origin = canonicalBareHttpsOrigin(
    authConfig(env).issuer,
    "OIDC_ISSUER_URL",
  );
  return new URL(path, origin).toString();
}

// ---- OIDC flow ---------------------------------------------------------------

async function exchangeCode(
  env: Env,
  code: string,
  codeVerifier: string,
): Promise<string> {
  const config = authConfig(env);
  const tokenEndpoint = issuerUrl(env, "/oauth/token");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId!,
    redirect_uri: callbackUrl(env),
    code_verifier: codeVerifier,
  });
  // PKCE public clients have no secret; send one only when configured.
  if (config.clientSecret) body.set("client_secret", config.clientSecret);
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    redirect: "manual",
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

function parseAppClaims(
  value: unknown,
): Pick<AppSession, "capsuleId" | "appRole"> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claims = value as Record<string, unknown>;
  if (!("capsule_id" in claims || "app_role" in claims)) return {};
  if (
    typeof claims.capsule_id !== "string" ||
    claims.capsule_id.trim() === "" ||
    (claims.app_role !== undefined &&
      claims.app_role !== "owner" &&
      claims.app_role !== "member")
  ) {
    return null;
  }
  return {
    capsuleId: claims.capsule_id,
    ...(claims.app_role !== undefined ? { appRole: claims.app_role } : {}),
  };
}

class UserInfoError extends Error {
  constructor(readonly status: number) {
    super(`OAuth userinfo failed: ${status}`);
  }
}

async function fetchUserInfo(env: Env, accessToken: string) {
  const userinfoEndpoint = issuerUrl(env, "/oauth/userinfo");
  const res = await fetch(userinfoEndpoint, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new UserInfoError(res.status);
  const body = (await res.json()) as {
    user?: { id?: string; name?: string };
    sub?: string;
    name?: string;
    workspace_memberships?: unknown;
    takosumi?: {
      workspace_id?: unknown;
      role?: unknown;
      capsule_id?: unknown;
      app_role?: unknown;
    };
  };
  const sub = body.user?.id ?? body.sub;
  if (!sub) throw new Error("OAuth userinfo response missing subject");
  const workspaceIds = normalizeWorkspaceIds(body.workspace_memberships);
  const nestedWorkspaceId = body.takosumi?.workspace_id;
  const expectedWorkspaceId = authConfig(env).workspaceId;
  const legacyRole = body.takosumi?.role;
  const validLegacyRole =
    legacyRole === undefined ||
    (typeof legacyRole === "string" &&
      ["owner", "admin", "member", "viewer"].includes(legacyRole));
  const legacyMember =
    expectedWorkspaceId !== undefined &&
    nestedWorkspaceId === expectedWorkspaceId &&
    validLegacyRole &&
    (workspaceIds.includes(expectedWorkspaceId) || legacyRole !== undefined);
  if (
    typeof nestedWorkspaceId === "string" &&
    nestedWorkspaceId.trim() !== "" &&
    !workspaceIds.includes(nestedWorkspaceId)
  ) {
    workspaceIds.push(nestedWorkspaceId);
  }
  return {
    sub,
    name: body.user?.name ?? body.name,
    workspaceIds,
    legacyMember,
    appClaims: authConfig(env).capsuleId ? parseAppClaims(body.takosumi) : {},
  };
}

// ---- Guard + session lookup --------------------------------------------------

async function readAppSession(
  env: Env,
  request: Request,
): Promise<{ session: StoredAppSession; modern: boolean } | null> {
  const config = authConfig(env);
  if (!config.sessionSecret) return null;
  const raw = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!raw || raw.length > MAX_SESSION_COOKIE_VALUE_BYTES) return null;
  const modern = raw.startsWith("v2.");
  const session = modern
    ? await openAppSession(raw, env)
    : await unseal<StoredAppSession>(raw, config.sessionSecret, "session");
  if (
    !session ||
    typeof session.sub !== "string" ||
    session.sub === "" ||
    typeof session.exp !== "number" ||
    session.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return { session, modern };
}

export async function getAppSession(
  env: Env,
  request: Request,
): Promise<AppSession | null> {
  const stored = await readAppSession(env, request);
  if (!stored) return null;
  // Access tokens are private to the data-authorization path, never callers of
  // the public identity helper or /api/auth/me.
  const session = stored.session;
  return {
    sub: session.sub,
    name: session.name,
    workspaceIds: session.workspaceIds,
    capsuleId: session.capsuleId,
    appRole: session.appRole,
    exp: session.exp,
  };
}

function sessionAccessDenied(env: Env, session: AppSession): Response | null {
  const config = authConfig(env);
  if (config.capsuleId) {
    if (
      session.capsuleId !== config.capsuleId ||
      (session.appRole !== undefined &&
        session.appRole !== "owner" &&
        session.appRole !== "member")
    ) {
      return Response.json({ error: "app_access_denied" }, { status: 403 });
    }
    // Identity admission grants no private data access without live membership.
    return null;
  }
  const memberships = Array.isArray(session.workspaceIds)
    ? session.workspaceIds
    : [];
  if (config.workspaceId && !memberships.includes(config.workspaceId)) {
    return Response.json(
      { error: "workspace_membership_required" },
      { status: 403 },
    );
  }
  return null;
}

function staleCapsuleSession(env: Env, session: AppSession): Response | null {
  if (authConfig(env).capsuleId && session.capsuleId === undefined) {
    return Response.json(
      { error: "reauthentication_required" },
      { status: 401, headers: { "Set-Cookie": clearCookie(SESSION_COOKIE) } },
    );
  }
  return null;
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
  const stored = await readAppSession(env, request);
  if (!stored) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { session, modern } = stored;
  const stale = staleCapsuleSession(env, session);
  if (stale) return stale;
  const denied = sessionAccessDenied(env, session);
  if (denied) return denied;
  // Existing installs without Capsule context retain Workspace admission.
  if (!config.capsuleId) return null;
  const membershipRequired = () =>
    Response.json({ error: "app_membership_required" }, { status: 403 });
  if (
    !modern ||
    typeof session.accessToken !== "string" ||
    !session.accessToken
  ) {
    return membershipRequired();
  }
  try {
    const user = await fetchUserInfo(env, session.accessToken);
    if (
      user.sub !== session.sub ||
      !user.appClaims ||
      user.appClaims.capsuleId !== config.capsuleId ||
      user.appClaims.capsuleId !== session.capsuleId ||
      (user.appClaims.appRole !== "owner" &&
        user.appClaims.appRole !== "member" &&
        !user.legacyMember)
    )
      return membershipRequired();
    return null;
  } catch (error) {
    if (error instanceof UserInfoError && error.status === 401) {
      return Response.json(
        { error: "reauthentication_required" },
        { status: 401, headers: { "Set-Cookie": clearCookie(SESSION_COOKIE) } },
      );
    }
    return membershipRequired();
  }
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
    const stale = staleCapsuleSession(env, session);
    if (stale) return stale;
    const denied = sessionAccessDenied(env, session);
    if (denied) return denied;
    return Response.json({
      required: true,
      sub: session.sub,
      name: session.name ?? null,
      ...(session.capsuleId !== undefined ? { authenticated: true } : {}),
      // Cached role claims cannot prove current membership. Storage exposes no
      // management signal until a future management surface revalidates it.
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
    const authUrl = new URL(issuerUrl(env, "/oauth/authorize"));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", config.clientId!);
    authUrl.searchParams.set("redirect_uri", callbackUrl(env));
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
    const accessToken = await exchangeCode(env, code, state.codeVerifier);
    const user = await fetchUserInfo(env, accessToken);
    if (user.appClaims === null) {
      return Response.json({ error: "invalid_app_claim" }, { status: 403 });
    }
    const sessionData: AppSession = {
      sub: user.sub,
      name: user.name,
      workspaceIds:
        user.appClaims.capsuleId !== undefined
          ? config.workspaceId && user.workspaceIds.includes(config.workspaceId)
            ? [config.workspaceId]
            : []
          : user.workspaceIds,
      ...user.appClaims,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
    };
    const denied = sessionAccessDenied(env, sessionData);
    if (denied) return denied;
    const session =
      sessionData.capsuleId !== undefined
        ? await sealAppSession({ ...sessionData, accessToken }, env)
        : await seal(sessionData, config.sessionSecret!, "session");
    if (session.length > MAX_SESSION_COOKIE_VALUE_BYTES) {
      return Response.json({ error: "session_too_large" }, { status: 502 });
    }
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
