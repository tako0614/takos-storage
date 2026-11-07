import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { MAX_STORAGE_FILE_BYTES } from "./mcp.ts";
import worker, { createStorageWorker } from "./worker.ts";
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
  customMetadata?: Record<string, string>;
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
      httpEtag: `"${createHash("md5").update(entry.data).digest("hex")}"`,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.customMetadata,
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
    if (!(onlyIf instanceof Headers) && onlyIf?.etagMatches?.startsWith('"')) {
      throw new TypeError("Conditional ETag should not be wrapped in quotes");
    }
    const etagMatches =
      onlyIf instanceof Headers
        ? onlyIf.get("if-match")
        : onlyIf?.etagMatches === undefined
          ? undefined
          : `"${onlyIf.etagMatches}"`;
    if (
      etagMatches != null &&
      (await this.get(key))?.httpEtag !== etagMatches
    ) {
      return null;
    }
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
      customMetadata: options?.customMetadata,
    });
    return (await this.get(key)) as R2Object;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.store.delete(key);
    }
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
      keys.map(async (key) => {
        const object = (await this.get(key))!;
        if (!options.include?.includes("customMetadata")) {
          delete object.customMetadata;
        }
        return object;
      }),
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
    });
    expect(missingConfig.status).toBe(503);

    const wrong = await worker.fetch(
      rpcRequest("tools/list", undefined, "wrong-token"),
      env(bucket),
    );
    expect(wrong.status).toBe(401);
  });

  test("derives the MCP audience and accepts complete live Interface evidence", async () => {
    const interfaceWorker = createStorageWorker(async () =>
      Response.json({
        token_use: "interface_oauth",
        sub: "principal_storage",
        aud: "https://storage.example/mcp",
        scope: "mcp.invoke",
        takosumi: {
          workspace_id: "workspace_a",
          capsule_id: "capsule_storage",
          interface_id: "interface_storage_mcp",
          interface_binding_id: "binding_mcp",
          interface_resolved_revision: 6,
        },
      }),
    );
    const response = await interfaceWorker.fetch(
      rpcRequest("tools/list", undefined, "taksrv_storage_mcp"),
      {
        BUCKET: new MemoryBucket(),
        OIDC_ISSUER_URL: "https://accounts.example",
        APP_CAPSULE_ID: "capsule_storage",
      },
    );
    expect(response.status).toBe(200);
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
    const writeSchema = rpc.result.tools[2].inputSchema as {
      properties: Record<string, unknown>;
    };
    const deleteSchema = rpc.result.tools[4].inputSchema as {
      required: string[];
    };
    const moveSchema = rpc.result.tools[5].inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(writeSchema.properties.expected_etag).toBeObject();
    expect(deleteSchema.required).toContain("expected_etag");
    expect(moveSchema.required).toContain("expected_source_etag");
    expect(moveSchema.properties.expected_destination_etag).toBeObject();
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

  test("creates by default and updates only the file's observed ETag", async () => {
    const bucket = new MemoryBucket();
    await callTool(bucket, "storage_file_write", {
      path: "note.txt",
      content: "original",
    });
    const original = structured(
      await callTool(bucket, "storage_file_read", { path: "note.txt" }),
    );
    const duplicate = await callTool(bucket, "storage_file_write", {
      path: "note.txt",
      content: "unconditional replacement",
    });
    expect((duplicate.result as Record<string, unknown>).isError).toBe(true);
    expect(
      structured(
        await callTool(bucket, "storage_file_read", { path: "note.txt" }),
      ).content,
    ).toBe("original");

    const updated = await callTool(bucket, "storage_file_write", {
      path: "note.txt",
      content: "current",
      expected_etag: original.etag,
    });
    expect((updated.result as Record<string, unknown>).isError).not.toBe(true);
    const stale = await callTool(bucket, "storage_file_write", {
      path: "note.txt",
      content: "stale replacement",
      expected_etag: original.etag,
    });
    expect((stale.result as Record<string, unknown>).isError).toBe(true);
    expect(
      structured(
        await callTool(bucket, "storage_file_read", { path: "note.txt" }),
      ).content,
    ).toBe("current");
  });

  test("deletes only the file's current observed ETag", async () => {
    const bucket = new MemoryBucket();
    const written = structured(
      await callTool(bucket, "storage_file_write", {
        path: "note.txt",
        content: "original",
      }),
    );
    const missing = await callTool(bucket, "storage_file_delete", {
      path: "note.txt",
    });
    expect((missing.result as Record<string, unknown>).isError).toBe(true);
    await callTool(bucket, "storage_file_write", {
      path: "note.txt",
      content: "current",
      expected_etag: written.etag,
    });
    const stale = await callTool(bucket, "storage_file_delete", {
      path: "note.txt",
      expected_etag: written.etag,
    });
    expect((stale.result as Record<string, unknown>).isError).toBe(true);
    const current = structured(
      await callTool(bucket, "storage_file_read", { path: "note.txt" }),
    );
    expect(current.content).toBe("current");
    const removed = await callTool(bucket, "storage_file_delete", {
      path: "note.txt",
      expected_etag: current.etag,
    });
    expect((removed.result as Record<string, unknown>).isError).not.toBe(true);
    const missingAfter = await callTool(bucket, "storage_file_read", {
      path: "note.txt",
    });
    expect((missingAfter.result as Record<string, unknown>).isError).toBe(true);
  });

  test("requires observed source and destination ETags for overwriting moves", async () => {
    const bucket = new MemoryBucket();
    const source = structured(
      await callTool(bucket, "storage_file_write", {
        path: "source.txt",
        content: "source",
      }),
    );
    const destination = structured(
      await callTool(bucket, "storage_file_write", {
        path: "destination.txt",
        content: "destination",
      }),
    );
    for (const args of [
      { expected_destination_etag: destination.etag },
      { expected_source_etag: source.etag },
      {
        expected_source_etag: source.etag,
        expected_destination_etag: '"stale"',
      },
      {
        expected_source_etag: '"stale"',
        expected_destination_etag: destination.etag,
      },
    ]) {
      const refused = await callTool(bucket, "storage_file_move", {
        source_path: "source.txt",
        destination_path: "destination.txt",
        overwrite: true,
        ...args,
      });
      expect((refused.result as Record<string, unknown>).isError).toBe(true);
      expect(
        structured(
          await callTool(bucket, "storage_file_read", { path: "source.txt" }),
        ).content,
      ).toBe("source");
      expect(
        structured(
          await callTool(bucket, "storage_file_read", {
            path: "destination.txt",
          }),
        ).content,
      ).toBe("destination");
    }
    const moved = await callTool(bucket, "storage_file_move", {
      source_path: "source.txt",
      destination_path: "destination.txt",
      overwrite: true,
      expected_source_etag: source.etag,
      expected_destination_etag: destination.etag,
    });
    expect((moved.result as Record<string, unknown>).isError).not.toBe(true);
    expect(
      structured(
        await callTool(bucket, "storage_file_read", {
          path: "destination.txt",
        }),
      ).content,
    ).toBe("source");
    expect(
      (
        (await callTool(bucket, "storage_file_read", { path: "source.txt" }))
          .result as Record<string, unknown>
      ).isError,
    ).toBe(true);
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
      expected_source_etag: info.etag,
    });
    expect((refused.result as Record<string, unknown>).isError).toBe(true);
    expect(bucket.store.has("drive/source.txt")).toBe(true);
    expect(
      new TextDecoder().decode(bucket.store.get("drive/existing.txt")?.data),
    ).toBe("existing");

    await callTool(bucket, "storage_file_move", {
      source_path: "source.txt",
      destination_path: "moved.txt",
      expected_source_etag: info.etag,
    });
    expect(bucket.store.has("drive/source.txt")).toBe(false);
    expect(bucket.store.get("drive/moved.txt")?.contentType).toBe(
      "text/custom",
    );

    const movedInfo = structured(
      await callTool(bucket, "storage_file_info", { path: "moved.txt" }),
    );
    await callTool(bucket, "storage_file_delete", {
      path: "moved.txt",
      expected_etag: movedInfo.etag,
    });
    expect(bucket.store.has("drive/moved.txt")).toBe(false);
  });

  test("hides a failed deletion marker across paginated MCP reads and listings", async () => {
    class CleanupFailureBucket extends MemoryBucket {
      override async delete(): Promise<void> {
        throw new Error("synthetic cleanup failure");
      }
    }
    const bucket = new CleanupFailureBucket();
    const original = structured(
      await callTool(bucket, "storage_file_write", {
        path: "a.txt",
        content: "",
      }),
    );
    await callTool(bucket, "storage_file_write", {
      path: "z.txt",
      content: "kept",
    });
    const deletion = await callTool(bucket, "storage_file_delete", {
      path: "a.txt",
      expected_etag: original.etag,
    });
    expect((deletion.error as Record<string, unknown>).code).toBe(-32603);
    for (const name of ["storage_file_read", "storage_file_info"]) {
      const missing = await callTool(bucket, name, { path: "a.txt" });
      expect((missing.result as Record<string, unknown>).isError).toBe(true);
    }
    const first = structured(
      await callTool(bucket, "storage_file_list", { limit: 1 }),
    );
    expect(first.files).toEqual([]);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBe("1");
    const second = structured(
      await callTool(bucket, "storage_file_list", {
        limit: 1,
        cursor: first.next_cursor,
      }),
    );
    expect(
      (second.files as Array<{ path: string }>).map((file) => file.path),
    ).toEqual(["z.txt"]);
    for (const args of [{}, { expected_etag: original.etag }]) {
      const refused = await callTool(bucket, "storage_file_write", {
        path: "a.txt",
        content: "late",
        ...args,
      });
      expect((refused.result as Record<string, unknown>).isError).toBe(true);
    }
  });

  test.each(["different bytes", "source"])(
    "retains a destination winner after incomplete replacement: %s",
    async (winner) => {
      class InterleavedBucket extends MemoryBucket {
        afterReplacement?: () => Promise<void>;
        override async put(
          key: string,
          value: ArrayBuffer | ReadableStream | string,
          options?: R2PutOptions,
        ): Promise<R2Object | null> {
          const result = await super.put(key, value, options);
          if (
            result &&
            key === "drive/destination.txt" &&
            this.afterReplacement
          ) {
            const run = this.afterReplacement;
            this.afterReplacement = undefined;
            await run();
          }
          return result;
        }
      }
      const bucket = new InterleavedBucket();
      const source = structured(
        await callTool(bucket, "storage_file_write", {
          path: "source.txt",
          content: "source",
        }),
      );
      const destination = structured(
        await callTool(bucket, "storage_file_write", {
          path: "destination.txt",
          content: "old destination",
        }),
      );
      bucket.afterReplacement = async () => {
        const updateSource = await callTool(bucket, "storage_file_write", {
          path: "source.txt",
          content: "updated source",
          expected_etag: source.etag,
        });
        expect(
          (updateSource.result as Record<string, unknown>).isError,
        ).not.toBe(true);
        const copy = structured(
          await callTool(bucket, "storage_file_info", {
            path: "destination.txt",
          }),
        );
        const updateDestination = await callTool(bucket, "storage_file_write", {
          path: "destination.txt",
          content: winner,
          content_type: "text/winner",
          expected_etag: copy.etag,
        });
        expect(
          (updateDestination.result as Record<string, unknown>).isError,
        ).not.toBe(true);
      };
      const partial = await callTool(bucket, "storage_file_move", {
        source_path: "source.txt",
        destination_path: "destination.txt",
        overwrite: true,
        expected_source_etag: source.etag,
        expected_destination_etag: destination.etag,
      });
      const result = partial.result as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("move_incomplete");
      expect(result.content[0].text).toContain("inspect both paths");
      const currentSource = structured(
        await callTool(bucket, "storage_file_read", { path: "source.txt" }),
      );
      const currentDestination = structured(
        await callTool(bucket, "storage_file_read", {
          path: "destination.txt",
        }),
      );
      expect(currentSource.content).toBe("updated source");
      expect(currentDestination.content).toBe(winner);
      expect(currentDestination.content_type).toBe("text/winner");
    },
  );

  test("rejects invalid revision arguments without changing files", async () => {
    const bucket = new MemoryBucket();
    const source = structured(
      await callTool(bucket, "storage_file_write", {
        path: "source.txt",
        content: "source",
      }),
    );
    const destination = structured(
      await callTool(bucket, "storage_file_write", {
        path: "destination.txt",
        content: "destination",
      }),
    );
    for (const invalid of [
      null,
      "",
      "*",
      'W/"weak"',
      '"one","two"',
      '"bad\r\nheader"',
      '"' + "x".repeat(256) + '"',
    ]) {
      for (const [name, args] of [
        [
          "storage_file_write",
          { path: "source.txt", content: "bad", expected_etag: invalid },
        ],
        ["storage_file_delete", { path: "source.txt", expected_etag: invalid }],
        [
          "storage_file_move",
          {
            source_path: "source.txt",
            destination_path: "new.txt",
            expected_source_etag: invalid,
          },
        ],
        [
          "storage_file_move",
          {
            source_path: "source.txt",
            destination_path: "destination.txt",
            expected_source_etag: source.etag,
            overwrite: true,
            expected_destination_etag: invalid,
          },
        ],
      ] as Array<[string, Record<string, unknown>]>) {
        const refused = await callTool(bucket, name, args);
        expect((refused.result as Record<string, unknown>).isError).toBe(true);
      }
    }
    expect(
      structured(
        await callTool(bucket, "storage_file_read", { path: "source.txt" }),
      ).content,
    ).toBe("source");
    expect(
      structured(
        await callTool(bucket, "storage_file_info", {
          path: "destination.txt",
        }),
      ).etag,
    ).toBe(destination.etag);
    const unnecessaryDestination = await callTool(bucket, "storage_file_move", {
      source_path: "source.txt",
      destination_path: "destination.txt",
      expected_source_etag: source.etag,
      expected_destination_etag: destination.etag,
    });
    expect(
      (unnecessaryDestination.result as Record<string, unknown>).isError,
    ).toBe(true);
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
