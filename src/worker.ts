/**
 * takos-storage — workspace object store service.
 *
 * A plain HTTP object API over a single R2 bucket, gated by scoped bearer
 * tokens that Takosumi mints at bind time. Each token is bounded to a key
 * prefix + verb set, so a consumer app can only touch its own slice.
 *
 *   GET    /healthz          liveness (no auth)
 *   GET    /, /ui            workspace drive UI (OIDC session when enabled)
 *   /api/auth/*              OIDC login/callback/me/logout (app-auth.ts)
 *   /api/drive/*             session-authed workspace drive files (drive.ts)
 *   POST   /mcp              bearer-protected storage_file_* MCP tools
 *   PUT    /o/<key>          store an object          (verb: w)
 *   GET    /o/<key>          fetch an object          (verb: r)
 *   HEAD   /o/<key>          object metadata          (verb: r)
 *   DELETE /o/<key>          remove an object         (verb: d)
 *   GET    /o?prefix=<p>     list keys under a prefix (verb: l)
 *   POST   /api/admin/empty  explicitly empty the module-owned bucket
 *
 * S3 SigV4 compatibility is intentionally out of scope for P0 (see the repo
 * README); this surface exists to prove the bind-time scoped-token flow.
 */

import type { Env } from "./types.ts";
import { storageConsoleHtml } from "./console.ts";
import { handleAuthRoute } from "./app-auth.ts";
import { handleDriveRoute } from "./drive.ts";
import { handleMcpRoute } from "./mcp.ts";
import {
  type StorageTokenVerb,
  tokenAllows,
  verifyStorageToken,
} from "./token.ts";

const OBJECT_PREFIX = "/o/";
const ADMIN_EMPTY_PATH = "/api/admin/empty";
const MAX_PURGE_PASSES = 10_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const VERB_BY_METHOD: Record<string, StorageTokenVerb> = {
  GET: "r",
  HEAD: "r",
  PUT: "w",
  DELETE: "d",
};

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

async function handleAdminEmpty(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ADMIN_EMPTY_PATH) return null;
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const expected = env.STORAGE_ADMIN_TOKEN ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const provided = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? "";
  if (
    expected.length < 32 ||
    !constantTimeEqual(provided, expected) ||
    request.headers.get("x-takos-storage-action") !== "empty"
  ) {
    return json({ error: "not_found" }, 404);
  }

  let deleted = 0;
  for (let pass = 0; pass < MAX_PURGE_PASSES; pass += 1) {
    const listing = await env.BUCKET.list({ limit: 1000 });
    const keys = listing.objects.map((object) => object.key);
    if (keys.length === 0) {
      return json({ ok: true, deleted });
    }
    await env.BUCKET.delete(keys);
    deleted += keys.length;
  }
  return json({ error: "empty_limit_exceeded", deleted }, 500);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ status: "ok", service: "takos-storage" });
    }
    const adminResponse = await handleAdminEmpty(request, env);
    if (adminResponse) return adminResponse;
    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/ui")
    ) {
      return html(storageConsoleHtml());
    }

    const mcpResponse = await handleMcpRoute(request, env);
    if (mcpResponse) return mcpResponse;

    // ---- Workspace drive (user session) ----
    const authResponse = await handleAuthRoute(request, env);
    if (authResponse) return authResponse;
    const driveResponse = await handleDriveRoute(request, env);
    if (driveResponse) return driveResponse;

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
    );
    if (!verified.ok)
      return json({ error: "invalid_token", reason: verified.reason }, 401);
    const { payload } = verified;

    // --- list ---
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
    let key: string;
    try {
      key = decodeURIComponent(url.pathname.slice(OBJECT_PREFIX.length));
    } catch {
      return json({ error: "invalid_key" }, 400);
    }
    if (!key) return json({ error: "empty_key" }, 400);

    const verb = VERB_BY_METHOD[request.method];
    if (!verb) return json({ error: "method_not_allowed" }, 405);
    if (!tokenAllows(payload, verb, key))
      return json({ error: "forbidden", verb, key }, 403);

    if (verb === "r") {
      const object = await env.BUCKET.get(key);
      if (!object) return json({ error: "not_found" }, 404);
      const headers = new Headers({
        "content-type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
      });
      if (object.httpEtag) headers.set("etag", object.httpEtag);
      if (request.method === "HEAD")
        return new Response(null, { status: 200, headers });
      return new Response(object.body, { status: 200, headers });
    }

    if (verb === "w") {
      const contentType =
        request.headers.get("content-type") ?? "application/octet-stream";
      const data = await request.arrayBuffer();
      await env.BUCKET.put(key, data, { httpMetadata: { contentType } });
      return json({ ok: true, key }, 201);
    }

    await env.BUCKET.delete(key);
    return json({ ok: true, key });
  },
};
