/**
 * takos-storage — workspace object store service.
 *
 * A plain HTTP object API over a single R2 bucket, gated by scoped bearer
 * tokens that Takosumi mints at bind time. Each token is bounded to a key
 * prefix + verb set, so a consumer app can only touch its own slice.
 *
 *   GET    /healthz          liveness (no auth)
 *   PUT    /o/<key>          store an object          (verb: w)
 *   GET    /o/<key>          fetch an object          (verb: r)
 *   HEAD   /o/<key>          object metadata          (verb: r)
 *   DELETE /o/<key>          remove an object         (verb: d)
 *   GET    /o?prefix=<p>     list keys under a prefix (verb: l)
 *
 * S3 SigV4 compatibility is intentionally out of scope for P0 (see the repo
 * README); this surface exists to prove the bind-time scoped-token flow.
 */

import type { Env } from "./types.ts";
import { type StorageTokenVerb, tokenAllows, verifyStorageToken } from "./token.ts";

const OBJECT_PREFIX = "/o/";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const VERB_BY_METHOD: Record<string, StorageTokenVerb> = {
  GET: "r",
  HEAD: "r",
  PUT: "w",
  DELETE: "d",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ status: "ok", service: "takos-storage" });
    }

    const isListPath = url.pathname === "/o" || url.pathname === "/o/";
    const isObjectPath = url.pathname.startsWith(OBJECT_PREFIX) && !isListPath;
    if (!isListPath && !isObjectPath) return json({ error: "not_found" }, 404);

    // --- authenticate ---
    const authHeader = request.headers.get("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!bearer) return json({ error: "missing_bearer_token" }, 401);
    if (!env.STORAGE_TOKEN_SIGNING_KEY) {
      return json({ error: "storage_signing_key_unconfigured" }, 503);
    }
    const verified = await verifyStorageToken(
      env.STORAGE_TOKEN_SIGNING_KEY,
      bearer[1],
      nowSeconds,
    );
    if (!verified.ok) return json({ error: "invalid_token", reason: verified.reason }, 401);
    const { payload } = verified;

    // --- list ---
    if (isListPath) {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (!payload.cap.includes("l")) return json({ error: "forbidden", verb: "l" }, 403);
      const requested = url.searchParams.get("prefix") ?? "";
      if (payload.pfx && !requested.startsWith(payload.pfx)) {
        return json({ error: "forbidden_prefix", allowed: payload.pfx }, 403);
      }
      const listing = await env.BUCKET.list({
        prefix: requested || payload.pfx,
        limit: 1000,
      });
      return json({
        objects: listing.objects.map((object) => ({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded,
        })),
        truncated: listing.truncated,
      });
    }

    // --- object ops ---
    const key = decodeURIComponent(url.pathname.slice(OBJECT_PREFIX.length));
    if (!key) return json({ error: "empty_key" }, 400);

    const verb = VERB_BY_METHOD[request.method];
    if (!verb) return json({ error: "method_not_allowed" }, 405);
    if (!tokenAllows(payload, verb, key)) return json({ error: "forbidden", verb, key }, 403);

    if (verb === "r") {
      const object = await env.BUCKET.get(key);
      if (!object) return json({ error: "not_found" }, 404);
      const headers = new Headers({
        "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      });
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
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
  },
};
