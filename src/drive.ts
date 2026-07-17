/**
 * Workspace drive — the user-facing file API behind the drive UI.
 *
 * Session-authenticated (see app-auth.ts) file routes over a fixed bucket
 * area. The server owns the `drive/` prefix: clients speak in relative file
 * paths and can never reach app-owned objects outside it. Runtime consumers
 * use Interface OAuth and each
 * InterfaceBinding is mapped to a private physical prefix by worker.ts.
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
import { boundedRequestBody, RequestBodyTooLargeError } from "./http-body.ts";

const DRIVE_PREFIX = "drive/";
const FILE_ROUTE = "/api/drive/file/";
const LIST_LIMIT = 1000;
const MAX_DRIVE_PATH_LENGTH = 1_024;

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
  if (
    !path ||
    path.length > MAX_DRIVE_PATH_LENGTH ||
    path.startsWith("/") ||
    path.includes("\0")
  )
    return null;
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
    if (request.method !== "GET")
      return json({ error: "method_not_allowed" }, 405);
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
      "content-type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }

  if (request.method === "PUT") {
    const contentType =
      request.headers.get("content-type") ?? "application/octet-stream";
    const body = boundedRequestBody(request);
    if (!body.ok) return json({ error: body.error }, body.status);
    try {
      await env.BUCKET.put(key, body.body, { httpMetadata: { contentType } });
      return json({ ok: true, path }, 201);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: "object_too_large" }, 413);
      }
      throw error;
    }
  }

  if (request.method === "DELETE") {
    await env.BUCKET.delete(key);
    return json({ ok: true, path });
  }

  return json({ error: "method_not_allowed" }, 405);
}
