// src/token.ts
var TOKEN_PREFIX = "takstor_";
var AUDIENCE = "takos.storage.workspace";
function b64urlDecode(value) {
  let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0)
    normalized += "=";
  const binary = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0;i < binary.length; i++)
    out[i] = binary.charCodeAt(i);
  return out;
}
async function importHmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function verifyStorageToken(signingKey, token, nowSeconds) {
  if (!token.startsWith(TOKEN_PREFIX))
    return { ok: false, reason: "format" };
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0 || dot >= rest.length - 1)
    return { ok: false, reason: "format" };
  const body = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  const key = await importHmacKey(signingKey);
  let signatureOk = false;
  try {
    signatureOk = await crypto.subtle.verify("HMAC", key, b64urlDecode(signature), new TextEncoder().encode(body));
  } catch {
    return { ok: false, reason: "signature" };
  }
  if (!signatureOk)
    return { ok: false, reason: "signature" };
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return { ok: false, reason: "payload" };
  }
  if (payload.v !== 1 || payload.aud !== AUDIENCE || !Array.isArray(payload.cap)) {
    return { ok: false, reason: "version" };
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
function tokenAllows(payload, verb, key) {
  if (!payload.cap.includes(verb))
    return false;
  if (payload.pfx && !key.startsWith(payload.pfx))
    return false;
  return true;
}

// src/worker.ts
var OBJECT_PREFIX = "/o/";
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
var VERB_BY_METHOD = {
  GET: "r",
  HEAD: "r",
  PUT: "w",
  DELETE: "d"
};
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ status: "ok", service: "takos-storage" });
    }
    const isListPath = url.pathname === "/o" || url.pathname === "/o/";
    const isObjectPath = url.pathname.startsWith(OBJECT_PREFIX) && !isListPath;
    if (!isListPath && !isObjectPath)
      return json({ error: "not_found" }, 404);
    const authHeader = request.headers.get("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!bearer)
      return json({ error: "missing_bearer_token" }, 401);
    if (!env.STORAGE_TOKEN_SIGNING_KEY) {
      return json({ error: "storage_signing_key_unconfigured" }, 503);
    }
    const verified = await verifyStorageToken(env.STORAGE_TOKEN_SIGNING_KEY, bearer[1], nowSeconds);
    if (!verified.ok)
      return json({ error: "invalid_token", reason: verified.reason }, 401);
    const { payload } = verified;
    if (isListPath) {
      if (request.method !== "GET")
        return json({ error: "method_not_allowed" }, 405);
      if (!payload.cap.includes("l"))
        return json({ error: "forbidden", verb: "l" }, 403);
      const requested = url.searchParams.get("prefix") ?? "";
      if (payload.pfx && !requested.startsWith(payload.pfx)) {
        return json({ error: "forbidden_prefix", allowed: payload.pfx }, 403);
      }
      const listing = await env.BUCKET.list({
        prefix: requested || payload.pfx,
        limit: 1000
      });
      return json({
        objects: listing.objects.map((object) => ({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded
        })),
        truncated: listing.truncated
      });
    }
    const key = decodeURIComponent(url.pathname.slice(OBJECT_PREFIX.length));
    if (!key)
      return json({ error: "empty_key" }, 400);
    const verb = VERB_BY_METHOD[request.method];
    if (!verb)
      return json({ error: "method_not_allowed" }, 405);
    if (!tokenAllows(payload, verb, key))
      return json({ error: "forbidden", verb, key }, 403);
    if (verb === "r") {
      const object = await env.BUCKET.get(key);
      if (!object)
        return json({ error: "not_found" }, 404);
      const headers = new Headers({
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream"
      });
      if (object.httpEtag)
        headers.set("etag", object.httpEtag);
      if (request.method === "HEAD")
        return new Response(null, { status: 200, headers });
      return new Response(object.body, { status: 200, headers });
    }
    if (verb === "w") {
      const contentType = request.headers.get("content-type") ?? "application/octet-stream";
      const data = await request.arrayBuffer();
      await env.BUCKET.put(key, data, { httpMetadata: { contentType } });
      return json({ ok: true, key }, 201);
    }
    await env.BUCKET.delete(key);
    return json({ ok: true, key });
  }
};
export {
  worker_default as default
};
