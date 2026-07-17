/**
 * Agent-facing storage MCP.
 *
 * This is intentionally a separate surface from `/o`: MCP callers can only
 * address user-facing files below the server-owned `drive/` prefix, while app
 * consumers use independently authorized InterfaceBindings with `/o`.
 * The implementation is dependency-free and stateless; managed calls use an
 * exact `mcp.invoke` Interface OAuth credential. Direct/self-host operators may
 * explicitly configure PUBLISHED_MCP_AUTH_TOKEN as a standalone fallback.
 */

import type { Env, R2Object } from "./types.ts";
import {
  hasValidInterfaceOAuthConfiguration,
  verifyInterfaceOAuthBearer,
} from "./interface-oauth-auth.ts";

export const MAX_STORAGE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_MCP_REQUEST_BYTES = 70 * 1024 * 1024;
const DRIVE_PREFIX = "drive/";
const MAX_PATH_BYTES = 1024;
const MAX_CURSOR_LENGTH = 4096;
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 1000;
const MCP_PROTOCOL_VERSION = "2025-03-26";

type JsonRecord = Record<string, unknown>;
type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: JsonRecord;
  isError?: boolean;
};
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonRecord;
  annotations: ToolAnnotations;
  handle: (args: JsonRecord, env: Env) => Promise<JsonRecord>;
};

class ToolInputError extends Error {}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

function toolResult(value: JsonRecord): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function requiredString(args: JsonRecord, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(args: JsonRecord, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`${name} must be a string`);
  }
  return value;
}

function filePath(
  value: string,
  options: { allowEmpty?: boolean } = {},
): string {
  if (value === "" && options.allowEmpty) return "";
  if (
    value === "" ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    new TextEncoder().encode(value).byteLength > MAX_PATH_BYTES
  ) {
    throw new ToolInputError("path must be a valid drive-relative path");
  }
  const segments = value.split("/");
  const finalEmpty = segments[segments.length - 1] === "";
  const checked = finalEmpty ? segments.slice(0, -1) : segments;
  if (
    checked.length === 0 ||
    checked.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new ToolInputError(
      "path must not contain empty, '.' or '..' segments",
    );
  }
  return value;
}

function requiredFilePath(args: JsonRecord, name: string): string {
  const path = filePath(requiredString(args, name));
  if (path.endsWith("/")) {
    throw new ToolInputError(`${name} must identify a file, not a prefix`);
  }
  return path;
}

function encodingArg(args: JsonRecord): "text" | "base64" {
  const value = args.encoding ?? "text";
  if (value !== "text" && value !== "base64") {
    throw new ToolInputError("encoding must be 'text' or 'base64'");
  }
  return value;
}

function contentTypeArg(args: JsonRecord, encoding: "text" | "base64"): string {
  const value = args.content_type;
  if (value === undefined) {
    return encoding === "text"
      ? "text/plain; charset=utf-8"
      : "application/octet-stream";
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    /[\r\n\u0000]/.test(value)
  ) {
    throw new ToolInputError("content_type must be a valid media type string");
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Keep chunks aligned to three bytes so concatenating their independently
  // encoded forms is identical to encoding the whole file, without first
  // constructing a second file-sized binary string.
  const chunkSize = 3 * 0x2000;
  const encoded: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    encoded.push(btoa(String.fromCharCode(...chunk)));
  }
  return encoded.join("");
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = /[\r\n\t ]/.test(value)
    ? value.replace(/[\r\n\t ]/g, "")
    : value;
  if (normalized.length === 0) return new Uint8Array();
  if (
    normalized.length > Math.ceil(MAX_STORAGE_FILE_BYTES / 3) * 4 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new ToolInputError("content is not valid base64 or exceeds 50 MiB");
  }
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  const decodedLength = Math.floor((normalized.length * 3) / 4) - padding;
  if (decodedLength > MAX_STORAGE_FILE_BYTES) {
    throw new ToolInputError("file exceeds the 50 MiB limit");
  }
  const output = new Uint8Array(decodedLength);
  const chunkSize = 4 * 0x2000;
  let outputOffset = 0;
  try {
    for (let offset = 0; offset < normalized.length; offset += chunkSize) {
      const binary = atob(normalized.slice(offset, offset + chunkSize));
      for (let index = 0; index < binary.length; index++) {
        output[outputOffset++] = binary.charCodeAt(index);
      }
    }
  } catch {
    throw new ToolInputError("content is not valid base64");
  }
  if (outputOffset !== decodedLength) {
    throw new ToolInputError("content is not valid base64");
  }
  return output;
}

function contentBytes(
  args: JsonRecord,
  encoding: "text" | "base64",
): Uint8Array {
  const content = args.content;
  if (typeof content !== "string") {
    throw new ToolInputError("content must be a string");
  }
  const bytes =
    encoding === "base64"
      ? base64ToBytes(content)
      : new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_STORAGE_FILE_BYTES) {
    throw new ToolInputError("file exceeds the 50 MiB limit");
  }
  return bytes;
}

function uploadedAt(object: R2Object): string {
  return object.uploaded instanceof Date
    ? object.uploaded.toISOString()
    : String(object.uploaded);
}

function objectMetadata(object: R2Object, path: string): JsonRecord {
  return {
    path,
    size: object.size,
    uploaded: uploadedAt(object),
    content_type:
      object.httpMetadata?.contentType ?? "application/octet-stream",
    etag: object.httpEtag ?? null,
  };
}

async function getDriveObject(env: Env, path: string): Promise<R2Object> {
  const object = await env.BUCKET.get(DRIVE_PREFIX + path);
  if (!object) throw new ToolInputError(`file not found: ${path}`);
  return object;
}

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const tools: ToolDefinition[] = [
  {
    name: "storage_file_list",
    description:
      "List user files in Takos Storage. Paths are relative to the isolated drive root.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description:
            "Optional drive-relative path prefix. Empty lists the drive root.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: `Maximum results for this page. Default: ${DEFAULT_LIST_LIMIT}.`,
        },
        cursor: {
          type: "string",
          description: "Opaque next_cursor returned by a previous list call.",
        },
      },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handle: async (args, env) => {
      const prefix = filePath(optionalString(args, "prefix") ?? "", {
        allowEmpty: true,
      });
      const rawLimit = args.limit ?? DEFAULT_LIST_LIMIT;
      if (
        typeof rawLimit !== "number" ||
        !Number.isInteger(rawLimit) ||
        rawLimit < 1 ||
        rawLimit > MAX_LIST_LIMIT
      ) {
        throw new ToolInputError(
          `limit must be an integer from 1 to ${MAX_LIST_LIMIT}`,
        );
      }
      const cursor = optionalString(args, "cursor");
      if (
        cursor !== undefined &&
        (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)
      ) {
        throw new ToolInputError("cursor is invalid");
      }
      const listing = await env.BUCKET.list({
        prefix: DRIVE_PREFIX + prefix,
        limit: rawLimit,
        ...(cursor ? { cursor } : {}),
      });
      return {
        files: listing.objects
          .filter((object) => object.key.startsWith(DRIVE_PREFIX))
          .map((object) => ({
            path: object.key.slice(DRIVE_PREFIX.length),
            size: object.size,
            uploaded: uploadedAt(object),
          })),
        truncated: listing.truncated,
        next_cursor: listing.truncated ? (listing.cursor ?? null) : null,
      };
    },
  },
  {
    name: "storage_file_read",
    description: "Read a user file from Takos Storage as UTF-8 text or base64.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Drive-relative file path." },
        encoding: {
          type: "string",
          enum: ["text", "base64"],
          description: "Response encoding. Default: text.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handle: async (args, env) => {
      const path = requiredFilePath(args, "path");
      const encoding = encodingArg(args);
      const object = await getDriveObject(env, path);
      if (object.size > MAX_STORAGE_FILE_BYTES) {
        throw new ToolInputError("file exceeds the 50 MiB limit");
      }
      const buffer = await object.arrayBuffer();
      if (buffer.byteLength > MAX_STORAGE_FILE_BYTES) {
        throw new ToolInputError("file exceeds the 50 MiB limit");
      }
      let content: string;
      if (encoding === "base64") {
        content = bytesToBase64(new Uint8Array(buffer));
      } else {
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
          throw new ToolInputError(
            "file is not valid UTF-8; read it with encoding=base64",
          );
        }
      }
      return { ...objectMetadata(object, path), encoding, content };
    },
  },
  {
    name: "storage_file_write",
    description:
      "Create or replace a user file in Takos Storage. The maximum decoded size is 50 MiB.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Drive-relative file path." },
        content: {
          type: "string",
          description: "Text or base64-encoded file content.",
        },
        encoding: {
          type: "string",
          enum: ["text", "base64"],
          description: "Input encoding. Default: text.",
        },
        content_type: {
          type: "string",
          description: "Optional media type to store.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handle: async (args, env) => {
      const path = requiredFilePath(args, "path");
      const encoding = encodingArg(args);
      const bytes = contentBytes(args, encoding);
      const contentType = contentTypeArg(args, encoding);
      await env.BUCKET.put(DRIVE_PREFIX + path, bytes.buffer as ArrayBuffer, {
        httpMetadata: { contentType },
      });
      return {
        ok: true,
        path,
        size: bytes.byteLength,
        content_type: contentType,
      };
    },
  },
  {
    name: "storage_file_info",
    description: "Get metadata for a user file in Takos Storage.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Drive-relative file path." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
    handle: async (args, env) => {
      const path = requiredFilePath(args, "path");
      return objectMetadata(await getDriveObject(env, path), path);
    },
  },
  {
    name: "storage_file_delete",
    description: "Delete a user file from Takos Storage.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Drive-relative file path." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handle: async (args, env) => {
      const path = requiredFilePath(args, "path");
      await getDriveObject(env, path);
      await env.BUCKET.delete(DRIVE_PREFIX + path);
      return { ok: true, path };
    },
  },
  {
    name: "storage_file_move",
    description:
      "Move a user file within Takos Storage. Existing destinations are preserved unless overwrite is true.",
    inputSchema: {
      type: "object",
      properties: {
        source_path: {
          type: "string",
          description: "Existing drive-relative file path.",
        },
        destination_path: {
          type: "string",
          description: "New drive-relative file path.",
        },
        overwrite: {
          type: "boolean",
          description: "Replace an existing destination. Default: false.",
        },
      },
      required: ["source_path", "destination_path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handle: async (args, env) => {
      const sourcePath = requiredFilePath(args, "source_path");
      const destinationPath = requiredFilePath(args, "destination_path");
      if (sourcePath === destinationPath) {
        throw new ToolInputError(
          "source_path and destination_path must differ",
        );
      }
      const overwrite = args.overwrite ?? false;
      if (typeof overwrite !== "boolean") {
        throw new ToolInputError("overwrite must be a boolean");
      }
      const source = await getDriveObject(env, sourcePath);
      if (source.size > MAX_STORAGE_FILE_BYTES) {
        throw new ToolInputError("file exceeds the 50 MiB limit");
      }
      const buffer = await source.arrayBuffer();
      if (buffer.byteLength > MAX_STORAGE_FILE_BYTES) {
        throw new ToolInputError("file exceeds the 50 MiB limit");
      }
      const written = await env.BUCKET.put(
        DRIVE_PREFIX + destinationPath,
        buffer,
        {
          httpMetadata: {
            contentType:
              source.httpMetadata?.contentType ?? "application/octet-stream",
          },
          ...(!overwrite ? { onlyIf: { etagDoesNotMatch: "*" } } : {}),
        },
      );
      if (!written) {
        throw new ToolInputError(
          `destination already exists: ${destinationPath}`,
        );
      }
      await env.BUCKET.delete(DRIVE_PREFIX + sourcePath);
      return {
        ok: true,
        source_path: sourcePath,
        destination_path: destinationPath,
        size: buffer.byteLength,
      };
    },
  },
];

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

async function constantTimeEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let different = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index++) {
    different |= leftBytes[index] ^ rightBytes[index];
  }
  return different === 0;
}

async function authorize(
  request: Request,
  env: Env,
  interfaceUserInfoFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): Promise<Response | null> {
  const configured = env.PUBLISHED_MCP_AUTH_TOKEN?.trim();
  const base = env.APP_URL?.trim();
  let audience = "";
  try {
    if (!base) throw new Error("APP_URL is required");
    audience = new URL("/mcp", `${base.replace(/\/$/u, "")}/`).href;
  } catch {
    // Invalid configuration remains fail closed.
  }
  const interfaceOAuthConfigured = hasValidInterfaceOAuthConfiguration({
    issuerUrl: env.OIDC_ISSUER_URL,
    audience,
    workspaceId: env.APP_WORKSPACE_ID,
    capsuleId: env.APP_CAPSULE_ID,
  });
  if (!configured && !interfaceOAuthConfigured) {
    return Response.json(
      { error: "MCP bearer authentication is not configured" },
      { status: 503 },
    );
  }
  const match = /^Bearer[ \t]+(.+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  const token = match?.[1]?.trim();
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (configured && (await constantTimeEqual(token, configured))) return null;
  if (
    interfaceOAuthConfigured &&
    (await verifyInterfaceOAuthBearer(request, token, "mcp.invoke", {
      issuerUrl: env.OIDC_ISSUER_URL,
      expectedAudience: audience,
      expectedWorkspaceId: env.APP_WORKSPACE_ID,
      expectedCapsuleId: env.APP_CAPSULE_ID,
      ...(interfaceUserInfoFetch ? { fetchImpl: interfaceUserInfoFetch } : {}),
    }))
  ) {
    return null;
  }
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_MCP_REQUEST_BYTES)
    return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let body = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_MCP_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

export async function handleMcpRoute(
  request: Request,
  env: Env,
  interfaceUserInfoFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return null;
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return Response.json({ error: "mcp_origin_forbidden" }, { status: 403 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS" },
    });
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "MCP Streamable HTTP requests must use POST" },
      { status: 405, headers: { Allow: "POST, OPTIONS" } },
    );
  }

  const denied = await authorize(request, env, interfaceUserInfoFetch);
  if (denied) return denied;

  const bodyText = await readBoundedBody(request);
  if (bodyText === null)
    return jsonRpcError(null, -32600, "Request body too large");
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }
  if (
    !isRecord(body) ||
    body.jsonrpc !== "2.0" ||
    typeof body.method !== "string"
  ) {
    return jsonRpcError(
      isRecord(body) ? body.id : null,
      -32600,
      "Invalid Request",
    );
  }

  const id = body.id;
  if (body.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "takos-storage", version: "0.2.4" },
    });
  }
  if (body.method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }
  if (body.method === "tools/list") {
    return jsonRpcResult(id, {
      tools: tools.map(({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        annotations,
      })),
    });
  }
  if (body.method !== "tools/call") {
    return jsonRpcError(id, -32601, "Method not found");
  }
  if (!isRecord(body.params) || typeof body.params.name !== "string") {
    return jsonRpcError(id, -32602, "Invalid params");
  }
  const tool = toolMap.get(body.params.name);
  if (!tool)
    return jsonRpcError(id, -32602, `Unknown tool: ${body.params.name}`);
  const args = isRecord(body.params.arguments) ? body.params.arguments : {};
  try {
    return jsonRpcResult(id, toolResult(await tool.handle(args, env)));
  } catch (error) {
    if (error instanceof ToolInputError) {
      return jsonRpcResult(id, toolError(error.message));
    }
    return jsonRpcError(
      id,
      -32603,
      error instanceof Error ? error.message : "Internal error",
    );
  }
}
