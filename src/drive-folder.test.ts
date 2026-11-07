import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import worker from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2PutOptions,
} from "./types.ts";

class Bucket implements R2Bucket {
  entries = new Map<
    string,
    { bytes: Uint8Array; etag: string; options?: R2PutOptions }
  >();
  effects = 0;
  pageSize = 1000;
  reportedSizes = new Map<string, number>();
  beforePut?: (key: string, options?: R2PutOptions) => Promise<void>;
  beforeDelete?: (key: string) => Promise<void>;
  async get(key: string): Promise<R2Object | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const bytes = entry.bytes.slice();
    return {
      key,
      size: this.reportedSizes.get(key) ?? bytes.length,
      uploaded: new Date(0),
      httpEtag: entry.etag,
      httpMetadata: entry.options?.httpMetadata,
      customMetadata: entry.options?.customMetadata,
      body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer,
    };
  }
  async put(
    key: string,
    body: string | ArrayBuffer | ReadableStream,
    options?: R2PutOptions,
  ) {
    await this.beforePut?.(key, options);
    const old = this.entries.get(key);
    const condition = options?.onlyIf;
    const match =
      condition instanceof Headers
        ? condition.get("if-match")
        : condition?.etagMatches;
    const absent =
      condition instanceof Headers
        ? condition.get("if-none-match")
        : condition?.etagDoesNotMatch;
    if ((match != null && old?.etag !== match) || (absent === "*" && old))
      return null;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.entries.set(key, {
      bytes,
      etag: '"' + createHash("md5").update(bytes).digest("hex") + '"',
      options,
    });
    this.effects++;
    return this.get(key);
  }
  async delete(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      await this.beforeDelete?.(key);
      if (this.entries.delete(key)) this.effects++;
    }
  }
  async list(options?: R2ListOptions) {
    const all = [...this.entries.keys()]
      .sort()
      .filter(
        (key) =>
          key.startsWith(options?.prefix ?? "") &&
          (!options?.cursor || key > options.cursor),
      );
    const keys = all.slice(0, Math.min(this.pageSize, options?.limit ?? 1000));
    const objects = (
      await Promise.all(keys.map((key) => this.get(key)))
    ).filter((x): x is R2Object => !!x);
    return {
      objects,
      truncated: all.length > keys.length,
      ...(all.length > keys.length ? { cursor: keys.at(-1) } : {}),
    };
  }
  async seed(path: string, value = "") {
    await this.put("drive/" + path, value, {
      httpMetadata: {
        contentType: path.endsWith("/")
          ? "application/x-directory"
          : "text/plain",
      },
    });
  }
  snapshot(prefix = "a/") {
    return [...this.entries]
      .filter(([key]) => key.startsWith("drive/" + prefix))
      .map(([key, entry]) => ({ path: key.slice(6), etag: entry.etag }));
  }
  bytes(path: string) {
    return new TextDecoder().decode(this.entries.get("drive/" + path)?.bytes);
  }
}
function send(bucket: Bucket, input: unknown, env?: Partial<Env>) {
  return worker.fetch(
    new Request("https://storage.fixture/api/drive/folder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
    { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1", ...env },
  );
}
function rename(bucket: Bucket, entries = bucket.snapshot()) {
  return send(bucket, {
    operation: "rename",
    source_path: "a/",
    destination_path: "b/",
    entries,
  });
}
function remove(bucket: Bucket, entries = bucket.snapshot()) {
  return send(bucket, { operation: "delete", source_path: "a/", entries });
}

describe("reviewed whole-folder Drive operations", () => {
  test("rename moves markers and nested Unicode content without touching other namespaces", async () => {
    const b = new Bucket();
    await b.seed("a/");
    await b.seed("a/子/");
    await b.seed("a/子/文書.txt", "日本語\u0000binary");
    await b.seed("ab/other.txt", "sibling");
    await b.put("private/app", "private");
    const response = await rename(b);
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toMatchObject({ ok: true });
    expect((result as { completed: string[] }).completed.sort()).toEqual([
      "a/",
      "a/子/",
      "a/子/文書.txt",
    ]);
    expect(b.snapshot()).toEqual([]);
    expect(b.bytes("b/子/文書.txt")).toBe("日本語\u0000binary");
    expect(
      b.entries.get("drive/b/子/文書.txt")?.options?.httpMetadata?.contentType,
    ).toBe("text/plain");
    expect(b.bytes("ab/other.txt")).toBe("sibling");
    expect(new TextDecoder().decode(b.entries.get("private/app")?.bytes)).toBe(
      "private",
    );
  });

  test("delete supports empty and implicit folders using only observed members", async () => {
    for (const paths of [["a/"], ["a/nested/file.txt", "a/other.txt"]]) {
      const b = new Bucket();
      for (const path of paths)
        await b.seed(path, path.endsWith("/") ? "" : "body");
      await b.seed("ab/keep.txt", "keep");
      const response = await remove(b);
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { completed: string[] }).completed.length,
      ).toBe(paths.length);
      expect(b.snapshot()).toEqual([]);
      expect(b.bytes("ab/keep.txt")).toBe("keep");
    }
  });

  test("stale, newly added, omitted, or disappeared members reject with no effects", async () => {
    for (const change of ["stale", "added", "omitted", "disappeared"]) {
      const b = new Bucket();
      await b.seed("a/");
      await b.seed("a/note", "one");
      const snapshot = b.snapshot();
      if (change === "stale") await b.seed("a/note", "two");
      if (change === "added") await b.seed("a/new", "new");
      if (change === "omitted") snapshot.pop();
      if (change === "disappeared") await b.delete("drive/a/note");
      const before = b.effects;
      expect((await remove(b, snapshot)).status).toBe(412);
      expect(b.effects).toBe(before);
    }
  });

  test("destination content, empty marker, or deletion marker blocks rename before effects", async () => {
    for (const path of ["b/file", "b/", "b/hidden"]) {
      const b = new Bucket();
      await b.seed("a/");
      await b.seed("a/file", "old");
      await b.seed(path, "");
      if (path === "b/hidden")
        await b.put("drive/" + path, "nonce", {
          customMetadata: { "takos-storage-deleting": "1" },
        });
      const before = b.effects;
      expect((await rename(b)).status).toBe(409);
      expect(b.effects).toBe(before);
    }
  });

  test("full prefix pagination precedes mutation and includes nested markers", async () => {
    const b = new Bucket();
    b.pageSize = 1;
    await b.seed("a/");
    await b.seed("a/one", "one");
    await b.seed("a/sub/");
    await b.seed("a/sub/two", "two");
    expect((await rename(b)).status).toBe(200);
    expect(b.snapshot("b/")).toHaveLength(4);
  });

  test("folder move keeps every copy and concurrent metadata writer after a late source conflict", async () => {
    const b = new Bucket();
    await b.seed("a/one.txt", "one");
    await b.seed("a/two.txt", "two");
    let injected = false;
    b.beforePut = async (key, options) => {
      if (
        !injected &&
        key === "drive/a/two.txt" &&
        options?.customMetadata?.["takos-storage-deleting"] === "1"
      ) {
        injected = true;
        b.beforePut = undefined;
        await b.seed("a/two.txt", "other source winner");
        await b.put("drive/b/two.txt", "two", {
          customMetadata: { winner: "other metadata writer" },
        });
      }
    };
    const response = await rename(b);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "folder_operation_incomplete",
      completed: ["a/one.txt"],
      failed_path: "a/two.txt",
      reconciliation_required: true,
    });
    expect(b.bytes("b/one.txt")).toBe("one");
    expect(b.bytes("a/two.txt")).toBe("other source winner");
    expect(b.bytes("b/two.txt")).toBe("two");
    expect(
      b.entries.get("drive/b/two.txt")?.options?.customMetadata?.winner,
    ).toBe("other metadata writer");
  });

  test("physical cleanup failure retains destination and explicitly reports uncertain member", async () => {
    const b = new Bucket();
    await b.seed("a/file", "only data");
    b.beforeDelete = async () => {
      throw new Error("synthetic local cleanup failure");
    };
    const response = await rename(b);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "folder_operation_incomplete",
      failed_path: "a/file",
      reconciliation_required: true,
    });
    expect(b.bytes("b/file")).toBe("only data");
    expect(
      b.entries.get("drive/a/file")?.options?.customMetadata?.[
        "takos-storage-deleting"
      ],
    ).toBe("1");
  });

  test("concurrent child created during deletion survives and prevents complete acknowledgement", async () => {
    const b = new Bucket();
    await b.seed("a/old", "old");
    let injected = false;
    b.beforePut = async (_key, options) => {
      if (
        !injected &&
        options?.customMetadata?.["takos-storage-deleting"] === "1"
      ) {
        injected = true;
        b.beforePut = undefined;
        await b.seed("a/new", "new");
      }
    };
    const response = await remove(b);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "folder_operation_incomplete",
      completed: ["a/old"],
      remaining: ["a/new"],
      reconciliation_required: true,
    });
    expect(b.bytes("a/new")).toBe("new");
  });

  test("invalid, overlapping, duplicate and out-of-prefix snapshots cannot mutate", async () => {
    const b = new Bucket();
    await b.seed("a/", "");
    const entries = b.snapshot();
    for (const input of [
      { operation: "delete", source_path: "", entries },
      { operation: "delete", source_path: "../a/", entries },
      {
        operation: "rename",
        source_path: "a/",
        destination_path: "a/sub/",
        entries,
      },
      {
        operation: "rename",
        source_path: "a/",
        destination_path: "a/",
        entries,
      },
      {
        operation: "delete",
        source_path: "a/",
        entries: [...entries, ...entries],
      },
      {
        operation: "delete",
        source_path: "a/",
        entries: [{ path: "ab/private", etag: '"x"' }],
      },
      {
        operation: "delete",
        source_path: "a/",
        entries: [{ path: "a/", etag: 'W/"x"' }],
      },
    ]) {
      const before = b.effects;
      expect((await send(b, input)).status).toBe(400);
      expect(b.effects).toBe(before);
    }
  });

  test("object count and aggregate bytes reject before any copy or removal", async () => {
    const b = new Bucket();
    for (let i = 0; i < 129; i++) await b.seed("a/" + i, "x");
    let before = b.effects;
    expect((await rename(b)).status).toBe(413);
    expect(b.effects).toBe(before);
    const bytes = new Bucket();
    for (let i = 0; i < 3; i++) {
      await bytes.seed("a/" + i, "x");
      bytes.reportedSizes.set("drive/a/" + i, 45 * 1024 * 1024);
    }
    before = bytes.effects;
    expect((await rename(bytes)).status).toBe(413);
    expect(bytes.effects).toBe(before);
  });

  test("residual source deletion markers and broken pagination reject with no effects", async () => {
    const b = new Bucket();
    await b.seed("a/note", "note");
    await b.put("drive/a/stuck", "nonce", {
      customMetadata: { "takos-storage-deleting": "1" },
    });
    let before = b.effects;
    expect((await remove(b)).status).toBe(412);
    expect(b.effects).toBe(before);
    const broken = new Bucket();
    await broken.seed("a/note", "note");
    const baseList = broken.list.bind(broken);
    broken.list = async (options) => ({
      ...(await baseList(options)),
      truncated: true,
      cursor: undefined,
    });
    before = broken.effects;
    expect((await remove(broken)).status).toBe(409);
    expect(broken.effects).toBe(before);
  });

  test("the same original authentication guard rejects incomplete configuration before mutation", async () => {
    const b = new Bucket();
    await b.seed("a/note", "note");
    const before = b.effects;
    expect(
      (
        await send(
          b,
          { operation: "delete", source_path: "a/", entries: b.snapshot() },
          { ALLOW_UNAUTHENTICATED_DRIVE: undefined },
        )
      ).status,
    ).toBe(503);
    expect(b.effects).toBe(before);
  });

  test("oversized and malformed folder requests fail before any mutation", async () => {
    const b = new Bucket();
    await b.seed("a/note", "note");
    const before = b.effects;
    expect(
      (
        await send(b, {
          operation: "delete",
          source_path: "a/",
          entries: b.snapshot(),
          padding: "x".repeat(256 * 1024),
        })
      ).status,
    ).toBe(413);
    const response = await worker.fetch(
      new Request("https://storage.fixture/api/drive/folder", {
        method: "POST",
        body: "{",
        headers: { "content-type": "application/json" },
      }),
      { BUCKET: b, ALLOW_UNAUTHENTICATED_DRIVE: "1" },
    );
    expect(response.status).toBe(400);
    expect(b.effects).toBe(before);
  });
});
