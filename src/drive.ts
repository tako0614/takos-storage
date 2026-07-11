/**
 * Workspace drive — the user-facing file API behind the drive UI.
 *
 * Session-authenticated (see app-auth.ts) file routes over a fixed bucket
 * area. The server owns the `drive/` prefix: clients speak in relative file
 * paths and can never reach app-owned objects outside it. Apps keep using
 * the `/o` API with `tksvc_` scoped credentials; the two surfaces share one
 * bucket but not credentials.
 *
 *   GET    /api/drive/list           all drive files (paths relative)
 *   GET    /api/drive/file/<path>    download (HEAD for metadata)
 *   PUT    /api/drive/file/<path>    upload / overwrite
 *   DELETE /api/drive/file/<path>    remove
 *
 * A "folder" is the usual object-store convention: a zero-byte key ending
 * in "/" plus any keys nested beneath it.
 */

import type { Env } from "./types.ts";
import { requireAppAuth } from "./app-auth.ts";

const DRIVE_PREFIX = "drive/";
const FILE_ROUTE = "/api/drive/file/";
const LIST_LIMIT = 1000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Decoded relative path, or null when it must be rejected. */
function drivePath(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname.slice(FILE_ROUTE.length));
  } catch {
    return null;
  }
  if (!path || path.startsWith("/")) return null;
  return path;
}

/** Handles /api/drive/*; null when the request is not a drive route. */
export async function handleDriveRoute(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/drive/")) return null;

  const unauthorized = await requireAppAuth(env, request);
  if (unauthorized) return unauthorized;

  if (url.pathname === "/api/drive/list") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const listing = await env.BUCKET.list({
      prefix: DRIVE_PREFIX,
      limit: LIST_LIMIT,
    });
    return json({
      files: listing.objects.map((object) => ({
        path: object.key.slice(DRIVE_PREFIX.length),
        size: object.size,
        uploaded: object.uploaded,
      })),
      truncated: listing.truncated,
    });
  }

  if (!url.pathname.startsWith(FILE_ROUTE)) {
    return json({ error: "not_found" }, 404);
  }
  const path = drivePath(url.pathname);
  if (path === null) return json({ error: "invalid_path" }, 400);
  const key = DRIVE_PREFIX + path;

  if (request.method === "GET" || request.method === "HEAD") {
    const object = await env.BUCKET.get(key);
    if (!object) return json({ error: "not_found" }, 404);
    const headers = new Headers({
      "content-type": object.httpMetadata?.contentType ??
        "application/octet-stream",
    });
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }

  if (request.method === "PUT") {
    const contentType = request.headers.get("content-type") ??
      "application/octet-stream";
    const data = await request.arrayBuffer();
    await env.BUCKET.put(key, data, { httpMetadata: { contentType } });
    return json({ ok: true, path }, 201);
  }

  if (request.method === "DELETE") {
    await env.BUCKET.delete(key);
    return json({ ok: true, path });
  }

  return json({ error: "method_not_allowed" }, 405);
}
