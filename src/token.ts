/**
 * Scoped storage access token.
 *
 * A short-lived, HMAC-SHA256 signed bearer token that authorizes a single
 * consumer installation to touch a bounded key space (`pfx`) with a bounded
 * set of verbs (`cap`). Takosumi mints these at bind time with the shared
 * signing key it injected into this service; the storage Worker verifies them
 * on every request. The token is opaque to the consumer.
 *
 * Wire form: `takstor_<base64url(payload)>.<base64url(hmac)>`
 *
 * This module is intentionally dependency-free and runs on Web Crypto so the
 * exact same format can be re-implemented on the Takosumi minting side.
 */

export type StorageTokenVerb = "r" | "w" | "d" | "l";

export interface StorageTokenPayload {
  /** Token format version. */
  v: 1;
  /** Workspace (space) id the grant belongs to. */
  ws: string;
  /** Consumer installation id the token was minted for. */
  sub: string;
  /** Key prefix the token is scoped to. Empty string means whole bucket. */
  pfx: string;
  /** Allowed verbs: read / write / delete / list. */
  cap: StorageTokenVerb[];
  /** Audience — always the storage publication name. */
  aud: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
}

export type StorageTokenVerifyResult =
  | { ok: true; payload: StorageTokenPayload }
  | { ok: false; reason: "format" | "signature" | "payload" | "version" | "expired" };

const TOKEN_PREFIX = "takstor_";
const AUDIENCE = "storage.object";

export { AUDIENCE as STORAGE_TOKEN_AUDIENCE, TOKEN_PREFIX as STORAGE_TOKEN_PREFIX };

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) normalized += "=";
  const binary = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Mint a signed scoped token. Kept here so tests (and the Takosumi mirror) share one format. */
export async function mintStorageToken(
  signingKey: string,
  payload: StorageTokenPayload,
): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(signingKey);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `${TOKEN_PREFIX}${body}.${b64urlEncode(signature)}`;
}

/** Verify signature, version, and expiry. Does NOT check scope — see {@link tokenAllows}. */
export async function verifyStorageToken(
  signingKey: string,
  token: string,
  nowSeconds: number,
): Promise<StorageTokenVerifyResult> {
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false, reason: "format" };
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot >= rest.length - 1) return { ok: false, reason: "format" };
  const body = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);

  const key = await importHmacKey(signingKey);
  let signatureOk = false;
  try {
    signatureOk = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(signature),
      new TextEncoder().encode(body),
    );
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (!signatureOk) return { ok: false, reason: "signature" };

  let payload: StorageTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as StorageTokenPayload;
  } catch {
    return { ok: false, reason: "payload" };
  }
  if (payload.v !== 1 || payload.aud !== AUDIENCE || !Array.isArray(payload.cap)) {
    return { ok: false, reason: "version" };
  }
  // Storage tokens are ALWAYS prefix-scoped; an empty/missing prefix would
  // otherwise authorize the whole bucket. Reject it here so a malformed mint
  // can never produce a whole-bucket token.
  if (typeof payload.pfx !== "string" || payload.pfx.length === 0) {
    return { ok: false, reason: "version" };
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

/** True when the token permits `verb` on `key` (key must be within the token prefix). */
export function tokenAllows(
  payload: StorageTokenPayload,
  verb: StorageTokenVerb,
  key: string,
): boolean {
  if (!payload.cap.includes(verb)) return false;
  // Deny when the prefix is empty (defense-in-depth: verify already rejects it).
  if (!payload.pfx || !key.startsWith(payload.pfx)) return false;
  return true;
}
