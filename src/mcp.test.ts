import { describe, expect, test } from "bun:test";

import { MAX_STORAGE_FILE_BYTES } from "./mcp.ts";
import worker from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2Objects,
  R2PutOptions,
} from "./types.ts";

const MCP_TOKEN = "published-storage-mcp-test-token";

type StoredObject = {
  data: Uint8Array;
  contentType: string;
  reportedSize?: number;
};

class MemoryBucket implements R2Bucket {
  readonly store = new Map<string, StoredObject>();
  arrayBufferReads = 0;

  async get(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.reportedSize ?? entry.data.byteLength,
      uploaded: new Date("2026-01-02T03:04:05.000Z"),
      httpEtag: '"mcp-etag"',
      httpMetadata: { contentType: entry.contentType },
      body: new Response(entry.data.slice()).body as ReadableStream,
      arrayBuffer: async () => {
        this.arrayBufferReads += 1;
        return entry.data.slice().buffer as ArrayBuffer;
      },
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const onlyIf = options?.onlyIf;
    const etagDoesNotMatch =
      onlyIf instanceof Headers
        ? onlyIf.get("if-none-match")
        : onlyIf?.etagDoesNotMatch;
    if (etagDoesNotMatch === "*" && this.store.has(key)) {
      return null;
    }
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer)
      data = new Uint8Array(value.slice(0));
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.store.set(key, {
      data,
      contentType:
        options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
    return (await this.get(key)) as R2Object;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    const prefix = options.prefix ?? "";
    const offset = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const matching = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const keys = matching.slice(offset, offset + limit);
    const objects = await Promise.all(
      keys.map((key) => this.get(key) as Promise<R2Object>),
    );
    const nextOffset = offset + keys.length;
    return {
      objects,
      truncated: nextOffset < matching.length,
      ...(nextOffset < matching.length ? { cursor: String(nextOffset) } : {}),
    };
  }
}

function env(bucket: R2Bucket, token: string | undefined = MCP_TOKEN): Env {
  return {
    BUCKET: bucket,
    STORAGE_TOKEN_SIGNING_KEY: "storage-object-signing-key",
    ...(token === undefined ? {} : { PUBLISHED_MCP_AUTH_TOKEN: token }),
  };
}

function rpcRequest(
  method: string,
  params?: Record<string, unknown>,
  token: string | undefined = MCP_TOKEN,
): Request {
  return new Request("https://storage.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function callTool(
  bucket: R2Bucket,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await worker.fetch(
    rpcRequest("tools/call", { name, arguments: args }),
    env(bucket),
  );
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

function structured(rpc: Record<string, unknown>): Record<string, unknown> {
  const result = rpc.result as Record<string, unknown>;
  return result.structuredContent as Record<string, unknown>;
}

describe("published storage MCP", () => {
  test("rejects cross-origin browser requests before authentication", async () => {
    const request = rpcRequest("tools/list", undefined, undefined);
    request.headers.set("origin", "https://attacker.example");
    const response = await worker.fetch(request, env(new MemoryBucket()));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "mcp_origin_forbidden" });
  });

  test("fails closed without the configured bearer and rejects a wrong bearer", async () => {
    const bucket = new MemoryBucket();
    const missingConfig = await worker.fetch(rpcRequest("tools/list"), {
      BUCKET: bucket,
      STORAGE_TOKEN_SIGNING_KEY: "storage-object-signing-key",
    });
    expect(missingConfig.status).toBe(503);

    const wrong = await worker.fetch(
      rpcRequest("tools/list", undefined, "wrong-token"),
      env(bucket),
    );
    expect(wrong.status).toBe(401);
  });

  test("advertises exactly the six storage tools with MCP annotations", async () => {
    const response = await worker.fetch(
      rpcRequest("tools/list"),
      env(new MemoryBucket()),
    );
    const rpc = (await response.json()) as {
      result: { tools: Array<Record<string, unknown>> };
    };
    expect(rpc.result.tools.map((tool) => tool.name)).toEqual([
      "storage_file_list",
      "storage_file_read",
      "storage_file_write",
      "storage_file_info",
      "storage_file_delete",
      "storage_file_move",
    ]);
    for (const tool of rpc.result.tools) {
      expect(tool.annotations).toBeObject();
      expect((tool.annotations as Record<string, unknown>).openWorldHint).toBe(
        false,
      );
    }
    expect(
      (rpc.result.tools[1].annotations as Record<string, unknown>).readOnlyHint,
    ).toBe(true);
    expect(
      (rpc.result.tools[4].annotations as Record<string, unknown>)
        .destructiveHint,
    ).toBe(true);
  });

  test("initializes as a stateless Streamable HTTP server", async () => {
    const response = await worker.fetch(
      rpcRequest("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
      env(new MemoryBucket()),
    );
    const rpc = (await response.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(rpc.result.protocolVersion).toBe("2025-03-26");
    expect(rpc.result.serverInfo.name).toBe("takos-storage");
  });

  test("round-trips text and base64 only below the drive prefix", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("consumer-app/private.bin", "app-owned");

    const written = structured(
      await callTool(bucket, "storage_file_write", {
        path: "notes/hello.txt",
        content: "hello MCP",
        content_type: "text/plain",
      }),
    );
    expect(written.path).toBe("notes/hello.txt");
    expect([...bucket.store.keys()].sort()).toEqual([
      "consumer-app/private.bin",
      "drive/notes/hello.txt",
    ]);

    const text = structured(
      await callTool(bucket, "storage_file_read", {
        path: "notes/hello.txt",
      }),
    );
    expect(text.content).toBe("hello MCP");
    expect(text.encoding).toBe("text");

    await callTool(bucket, "storage_file_write", {
      path: "bytes/data.bin",
      content: "AAEC/w==",
      encoding: "base64",
    });
    const binary = structured(
      await callTool(bucket, "storage_file_read", {
        path: "bytes/data.bin",
        encoding: "base64",
      }),
    );
    expect(binary.content).toBe("AAEC/w==");

    await callTool(bucket, "storage_file_write", {
      path: "empty.txt",
      content: "",
    });
    const empty = structured(
      await callTool(bucket, "storage_file_read", {
        path: "empty.txt",
      }),
    );
    expect(empty.content).toBe("");
  });

  test("rejects traversal and never exposes app-owned object API keys", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("workspace/app/secret.txt", "secret");
    const invalid = await callTool(bucket, "storage_file_read", {
      path: "../workspace/app/secret.txt",
    });
    expect((invalid.result as Record<string, unknown>).isError).toBe(true);

    await bucket.put("drive/public.txt", "public");
    const listing = structured(await callTool(bucket, "storage_file_list", {}));
    expect(listing.files).toEqual([
      { path: "public.txt", size: 6, uploaded: "2026-01-02T03:04:05.000Z" },
    ]);
  });

  test("passes opaque R2 cursors through paginated drive listings", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("drive/a.txt", "a");
    await bucket.put("drive/b.txt", "b");
    const first = structured(
      await callTool(bucket, "storage_file_list", { limit: 1 }),
    );
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBe("1");
    const second = structured(
      await callTool(bucket, "storage_file_list", {
        limit: 1,
        cursor: first.next_cursor,
      }),
    );
    expect((second.files as Array<{ path: string }>)[0].path).toBe("b.txt");
    expect(second.truncated).toBe(false);
  });

  test("reports metadata, moves files without clobbering, and deletes them", async () => {
    const bucket = new MemoryBucket();
    await bucket.put("drive/source.txt", "source", {
      httpMetadata: { contentType: "text/custom" },
    });
    await bucket.put("drive/existing.txt", "existing");

    const info = structured(
      await callTool(bucket, "storage_file_info", {
        path: "source.txt",
      }),
    );
    expect(info.content_type).toBe("text/custom");
    expect(info.size).toBe(6);

    const refused = await callTool(bucket, "storage_file_move", {
      source_path: "source.txt",
      destination_path: "existing.txt",
    });
    expect((refused.result as Record<string, unknown>).isError).toBe(true);
    expect(bucket.store.has("drive/source.txt")).toBe(true);
    expect(
      new TextDecoder().decode(bucket.store.get("drive/existing.txt")?.data),
    ).toBe("existing");

    await callTool(bucket, "storage_file_move", {
      source_path: "source.txt",
      destination_path: "moved.txt",
    });
    expect(bucket.store.has("drive/source.txt")).toBe(false);
    expect(bucket.store.get("drive/moved.txt")?.contentType).toBe(
      "text/custom",
    );

    await callTool(bucket, "storage_file_delete", { path: "moved.txt" });
    expect(bucket.store.has("drive/moved.txt")).toBe(false);
  });

  test("rejects oversized objects from metadata before buffering their body", async () => {
    const bucket = new MemoryBucket();
    bucket.store.set("drive/huge.bin", {
      data: new Uint8Array([1]),
      contentType: "application/octet-stream",
      reportedSize: MAX_STORAGE_FILE_BYTES + 1,
    });
    const result = await callTool(bucket, "storage_file_read", {
      path: "huge.bin",
      encoding: "base64",
    });
    expect((result.result as Record<string, unknown>).isError).toBe(true);
    expect(bucket.arrayBufferReads).toBe(0);
  });
});
