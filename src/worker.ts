/**
 * takos-storage — workspace object store service.
 *
 * Runtime object calls use invocation-only Takosumi Interface OAuth
 * credentials. Every call is checked against one exact permission and the
 * canonical /o resource URI; the resolved InterfaceBinding id is the physical
 * storage namespace boundary.
 */

import type { Env } from "./types.ts";
import { storageConsoleHtml } from "./console.ts";
import { handleAuthRoute } from "./app-auth.ts";
import { handleDriveRoute } from "./drive.ts";
import { handleMcpRoute } from "./mcp.ts";
import {
  authorizeInterfaceOAuthBearer,
  hasValidInterfaceOAuthConfiguration,
} from "./interface-oauth-auth.ts";
import iconSvg from "../public/icons/takos-storage.svg" with { type: "text" };
import {
  boundedRequestBody,
  conditionalWriteHeaders,
  RequestBodyTooLargeError,
} from "./http-body.ts";

const OBJECT_PREFIX = "/o/";
const INTERFACE_BINDING_PREFIX = "interface-bindings/";
const MAX_CURSOR_LENGTH = 4_096;
const MAX_OBJECT_KEY_LENGTH = 1_024;
const ICON_PATH = "/icons/takos-storage.svg";

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

function svgAsset(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}

const OBJECT_PERMISSION_BY_METHOD: Readonly<Record<string, string>> = {
  GET: "storage.object.read",
  HEAD: "storage.object.read",
  PUT: "storage.object.write",
  DELETE: "storage.object.delete",
};

function interfaceResourceUri(env: Env, path: string): string {
  const base = env.APP_URL?.trim();
  if (!base) return "";
  try {
    return new URL(path, `${base.replace(/\/$/u, "")}/`).href;
  } catch {
    return "";
  }
}

function bindingStoragePrefix(interfaceBindingId: string): string {
  return `${INTERFACE_BINDING_PREFIX}${encodeURIComponent(interfaceBindingId)}/`;
}

function validRelativeKey(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_OBJECT_KEY_LENGTH &&
    !value.startsWith("/") &&
    !value.includes("\0")
  );
}

function validRelativePrefix(value: string): boolean {
  return (
    value.length <= MAX_OBJECT_KEY_LENGTH &&
    !value.startsWith("/") &&
    !value.includes("\0")
  );
}

export type InterfaceUserInfoFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function fetchHandler(
  request: Request,
  env: Env,
  interfaceUserInfoFetch?: InterfaceUserInfoFetch,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json({ status: "ok", service: "takos-storage" });
  }
  if (request.method === "GET" && url.pathname === ICON_PATH) {
    return svgAsset(iconSvg);
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/ui")
  ) {
    return html(storageConsoleHtml());
  }

  const mcpResponse = await handleMcpRoute(
    request,
    env,
    interfaceUserInfoFetch,
  );
  if (mcpResponse) return mcpResponse;

  const authResponse = await handleAuthRoute(request, env);
  if (authResponse) return authResponse;
  const driveResponse = await handleDriveRoute(request, env);
  if (driveResponse) return driveResponse;

  const isListPath = url.pathname === "/o" || url.pathname === "/o/";
  const isObjectPath = url.pathname.startsWith(OBJECT_PREFIX) && !isListPath;
  if (!isListPath && !isObjectPath) return json({ error: "not_found" }, 404);

  const expectedPermission = isListPath
    ? request.method === "GET"
      ? "storage.object.list"
      : null
    : (OBJECT_PERMISSION_BY_METHOD[request.method] ?? null);
  if (!expectedPermission) return json({ error: "method_not_allowed" }, 405);

  const audience = interfaceResourceUri(env, "/o");
  if (
    !hasValidInterfaceOAuthConfiguration({
      issuerUrl: env.OIDC_ISSUER_URL,
      audience,
      workspaceId: env.APP_WORKSPACE_ID,
      capsuleId: env.APP_CAPSULE_ID,
    })
  ) {
    return json({ error: "interface_oauth_unconfigured" }, 503);
  }

  const bearer = /^Bearer\s+(.+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!bearer) return json({ error: "missing_bearer_token" }, 401);
  const authorization = await authorizeInterfaceOAuthBearer(
    request,
    bearer[1],
    expectedPermission,
    {
      issuerUrl: env.OIDC_ISSUER_URL,
      expectedAudience: audience,
      expectedWorkspaceId: env.APP_WORKSPACE_ID,
      expectedCapsuleId: env.APP_CAPSULE_ID,
      ...(interfaceUserInfoFetch ? { fetchImpl: interfaceUserInfoFetch } : {}),
    },
  );
  if (!authorization) {
    return json({ error: "invalid_interface_oauth_token" }, 401);
  }
  const storagePrefix = bindingStoragePrefix(authorization.interfaceBindingId);

  if (isListPath) {
    const requested = url.searchParams.get("prefix") ?? "";
    if (!validRelativePrefix(requested)) {
      return json({ error: "invalid_prefix" }, 400);
    }
    const cursor = url.searchParams.get("cursor");
    if (
      cursor !== null &&
      (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)
    ) {
      return json({ error: "invalid_cursor" }, 400);
    }
    const listing = await env.BUCKET.list({
      prefix: `${storagePrefix}${requested}`,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });
    return json({
      objects: listing.objects.map((object) => ({
        key: object.key.slice(storagePrefix.length),
        size: object.size,
        uploaded: object.uploaded,
      })),
      truncated: listing.truncated,
      ...(listing.truncated && listing.cursor
        ? { cursor: listing.cursor }
        : {}),
    });
  }

  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice(OBJECT_PREFIX.length));
  } catch {
    return json({ error: "invalid_key" }, 400);
  }
  if (!validRelativeKey(key)) return json({ error: "invalid_key" }, 400);
  const physicalKey = `${storagePrefix}${key}`;

  if (expectedPermission === "storage.object.read") {
    const object = await env.BUCKET.get(physicalKey);
    if (!object) return json({ error: "not_found" }, 404);
    const headers = new Headers({
      "content-type":
        object.httpMetadata?.contentType ?? "application/octet-stream",
    });
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(object.body, { status: 200, headers });
  }

  if (expectedPermission === "storage.object.write") {
    const contentType =
      request.headers.get("content-type") ?? "application/octet-stream";
    const body = boundedRequestBody(request);
    if (!body.ok) return json({ error: body.error }, body.status);
    const onlyIf = conditionalWriteHeaders(request);
    try {
      const object = await env.BUCKET.put(physicalKey, body.body, {
        httpMetadata: { contentType },
        ...(onlyIf ? { onlyIf } : {}),
      });
      if (!object) return json({ error: "precondition_failed" }, 412);
      return json({ ok: true, key }, 201);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: "object_too_large" }, 413);
      }
      throw error;
    }
  }

  await env.BUCKET.delete(physicalKey);
  return json({ ok: true, key });
}

export function createStorageWorker(
  interfaceUserInfoFetch?: InterfaceUserInfoFetch,
): { fetch(request: Request, env: Env): Promise<Response> } {
  return {
    fetch: (request, env) => fetchHandler(request, env, interfaceUserInfoFetch),
  };
}

export default createStorageWorker();
