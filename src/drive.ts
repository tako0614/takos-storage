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
 *   PUT    /api/drive/file/<path>    create or exact-revision update
 *   DELETE /api/drive/file/<path>    exact-revision remove
 *
 * A "folder" is the usual object-store convention: a zero-byte key ending
 * in "/" plus any keys nested beneath it.
 */

import type { Env } from "./types.ts";
import { requireAppAuth } from "./app-auth.ts";
import {
  boundedRequestBody,
  MAX_STORED_OBJECT_BYTES,
  RequestBodyTooLargeError,
  storedContentType,
} from "./http-body.ts";
import {
  deleteDriveObject,
  DRIVE_PREFIX,
  DriveOperationError,
  getDriveObject,
  isDriveDeletionTombstone,
  moveDriveObject,
} from "./drive-operations.ts";
import { isValidDrivePath } from "./drive-path.ts";

const FILE_ROUTE = "/api/drive/file/";
const MOVE_ROUTE = "/api/drive/move";
const LIST_LIMIT = 1000;
const MAX_CURSOR_LENGTH = 4_096;
const MAX_MOVE_REQUEST_BYTES = 8 * 1024;

/**
 * Stored bytes are uploader-controlled, so a download must never be able to
 * become an active document on the session origin: the declared type is
 * neutralised, the response is forced into the download path, and the CSP
 * keeps a directly-opened raw URL inert even if a browser ignores the rest.
 */
const DOWNLOAD_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/octet-stream",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "referrer-policy": "no-referrer",
};

function downloadHeaders(path: string, contentType: string): Headers {
  const headers = new Headers(DOWNLOAD_HEADERS);
  const filename = path.slice(path.lastIndexOf("/") + 1);
  headers.set(
    "content-disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  // The real media type still travels, in a header no browser will act on, so
  // clients that copy objects can preserve it.
  headers.set("x-takos-storage-content-type", contentType);
  return headers;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Decoded relative path, or null when it must be rejected. */
function drivePath(pathname: string): string | null {
  try {
    const path = decodeURIComponent(pathname.slice(FILE_ROUTE.length));
    return isValidDrivePath(path) ? path : null;
  } catch {
    return null;
  }
}

function exactEtag(value: string | null): string | null {
  const etag = value?.trim() ?? "";
  return etag &&
    etag !== "*" &&
    etag.length <= 256 &&
    !etag.includes(",") &&
    !/[\u0000-\u001f\u007f]/u.test(etag)
    ? etag
    : null;
}

function writePrecondition(
  request: Request,
): { onlyIf: Headers } | { response: Response } {
  const ifMatch = request.headers.get("if-match");
  const ifNoneMatch = request.headers.get("if-none-match");
  if ((ifMatch === null) === (ifNoneMatch === null)) {
    return {
      response: json(
        { error: "one_write_precondition_required" },
        ifMatch === null ? 428 : 400,
      ),
    };
  }
  if (ifNoneMatch !== null && ifNoneMatch.trim() !== "*") {
    return { response: json({ error: "invalid_if_none_match" }, 400) };
  }
  if (ifMatch !== null && exactEtag(ifMatch) === null) {
    return { response: json({ error: "invalid_if_match" }, 400) };
  }
  const onlyIf = new Headers();
  if (ifMatch !== null) onlyIf.set("if-match", ifMatch.trim());
  else onlyIf.set("if-none-match", "*");
  return { onlyIf };
}

function operationError(error: DriveOperationError): Response {
  const status =
    error.code === "not_found"
      ? 404
      : error.code === "too_large"
        ? 413
        : error.code === "revision_conflict"
          ? 412
          : 409;
  return json({ error: error.code }, status);
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
    // Same cursor contract as /o so clients can browse and account for every
    // member instead of silently stopping at the first R2 page.
    const cursor = url.searchParams.get("cursor");
    if (
      cursor !== null &&
      (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)
    ) {
      return json({ error: "invalid_cursor" }, 400);
    }
    const listing = await env.BUCKET.list({
      prefix: DRIVE_PREFIX,
      limit: LIST_LIMIT,
      include: ["customMetadata"],
      ...(cursor ? { cursor } : {}),
    });
    return json({
      files: listing.objects
        .filter((object) => !isDriveDeletionTombstone(object))
        .map((object) => ({
          path: object.key.slice(DRIVE_PREFIX.length),
          size: object.size,
          uploaded: object.uploaded,
        })),
      truncated: listing.truncated,
      ...(listing.truncated && listing.cursor
        ? { cursor: listing.cursor }
        : {}),
    });
  }

  if (url.pathname === MOVE_ROUTE) {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    const bounded = boundedRequestBody(request, MAX_MOVE_REQUEST_BYTES);
    if (!bounded.ok) return json({ error: bounded.error }, bounded.status);
    let input: unknown;
    try {
      input = await new Response(bounded.body).json();
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: "request_too_large" }, 413);
      }
      return json({ error: "invalid_json" }, 400);
    }
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      typeof (input as Record<string, unknown>).source_path !== "string" ||
      typeof (input as Record<string, unknown>).destination_path !== "string" ||
      typeof (input as Record<string, unknown>).source_etag !== "string"
    ) {
      return json({ error: "invalid_move" }, 400);
    }
    const {
      source_path: sourcePath,
      destination_path: destinationPath,
      source_etag: sourceEtag,
    } = input as {
      source_path: string;
      destination_path: string;
      source_etag: string;
    };
    const expectedSourceEtag = exactEtag(sourceEtag);
    if (
      !isValidDrivePath(sourcePath, { allowFolder: false }) ||
      !isValidDrivePath(destinationPath, { allowFolder: false }) ||
      expectedSourceEtag === null ||
      sourcePath === destinationPath
    ) {
      return json({ error: "invalid_move" }, 400);
    }
    try {
      const moved = await moveDriveObject(
        env.BUCKET,
        sourcePath,
        destinationPath,
        expectedSourceEtag,
        MAX_STORED_OBJECT_BYTES,
      );
      return json({
        ok: true,
        source_path: sourcePath,
        destination_path: destinationPath,
        size: moved.size,
      });
    } catch (error) {
      if (error instanceof DriveOperationError) return operationError(error);
      throw error;
    }
  }

  if (!url.pathname.startsWith(FILE_ROUTE)) {
    return json({ error: "not_found" }, 404);
  }
  const path = drivePath(url.pathname);
  if (path === null) return json({ error: "invalid_path" }, 400);
  const key = DRIVE_PREFIX + path;

  if (request.method === "GET" || request.method === "HEAD") {
    let object;
    try {
      object = await getDriveObject(env.BUCKET, path);
    } catch (error) {
      if (error instanceof DriveOperationError) return operationError(error);
      throw error;
    }
    const headers = downloadHeaders(
      path,
      storedContentType(object.httpMetadata?.contentType),
    );
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }

  if (request.method === "PUT") {
    const precondition = writePrecondition(request);
    if ("response" in precondition) return precondition.response;
    const contentType = storedContentType(request.headers.get("content-type"));
    const body = boundedRequestBody(request);
    if (!body.ok) return json({ error: body.error }, body.status);
    try {
      const object = await env.BUCKET.put(key, body.body, {
        httpMetadata: { contentType },
        onlyIf: precondition.onlyIf,
      });
      if (!object) return json({ error: "precondition_failed" }, 412);
      return json({ ok: true, path }, 201);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: "object_too_large" }, 413);
      }
      throw error;
    }
  }

  if (request.method === "DELETE") {
    if (path.endsWith("/")) {
      return json({ error: "folder_operation_unsupported" }, 400);
    }
    const ifMatch = exactEtag(request.headers.get("if-match"));
    if (!request.headers.has("if-match")) {
      return json({ error: "if_match_required" }, 428);
    }
    if (!ifMatch) return json({ error: "invalid_if_match" }, 400);
    try {
      await deleteDriveObject(env.BUCKET, path, ifMatch);
      return json({ ok: true, path });
    } catch (error) {
      if (error instanceof DriveOperationError) return operationError(error);
      throw error;
    }
  }

  return json({ error: "method_not_allowed" }, 405);
}
