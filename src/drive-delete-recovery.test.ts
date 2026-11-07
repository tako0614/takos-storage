import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import worker from "./worker.ts";
import type {
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2PutOptions,
} from "./types.ts";

class Bucket implements R2Bucket {
  data = new Map<
    string,
    { bytes: Uint8Array; etag: string; options?: R2PutOptions }
  >();
  effects = 0;
  failCleanup = false;
  pageSize = 1000;
  beforePut?: (key: string, options?: R2PutOptions) => Promise<void>;
  beforeDelete?: (key: string) => Promise<void>;
  async get(key: string): Promise<R2Object | null> {
    const object = this.data.get(key);
    if (!object) return null;
    const bytes = object.bytes.slice();
    return {
      key,
      size: bytes.length,
      uploaded: new Date(0),
      httpEtag: object.etag,
      httpMetadata: object.options?.httpMetadata,
      customMetadata: object.options?.customMetadata,
      body: new Response(bytes).body!,
      arrayBuffer: async () => bytes.buffer,
    };
  }
  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: R2PutOptions,
  ) {
    await this.beforePut?.(key, options);
    const condition = options?.onlyIf;
    const match =
      condition instanceof Headers
        ? condition.get("if-match")
        : condition?.etagMatches;
    const absent =
      condition instanceof Headers
        ? condition.get("if-none-match")
        : condition?.etagDoesNotMatch;
    if (
      (match != null && this.data.get(key)?.etag !== match) ||
      (absent === "*" && this.data.has(key))
    )
      return null;
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    this.data.set(key, {
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
      if (this.failCleanup)
        throw new Error("synthetic physical cleanup failure");
      if (this.data.delete(key)) this.effects++;
    }
  }
  async list(options?: R2ListOptions) {
    const all = [...this.data.keys()]
      .sort()
      .filter(
        (key) =>
          key.startsWith(options?.prefix ?? "") &&
          (!options?.cursor || key > options.cursor),
      );
    const keys = all.slice(0, Math.min(options?.limit ?? 1000, this.pageSize));
    const objects = (
      await Promise.all(keys.map((key) => this.get(key)))
    ).filter((x): x is R2Object => !!x);
    return {
      objects,
      truncated: all.length > keys.length,
      ...(all.length > keys.length ? { cursor: keys.at(-1) } : {}),
    };
  }
}
function call(
  bucket: Bucket,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  return worker.fetch(
    new Request("https://storage.fixture" + path, {
      method,
      ...(body !== undefined
        ? { body: typeof body === "string" ? body : JSON.stringify(body) }
        : {}),
      headers: { "content-type": "application/json", ...headers },
    }),
    { BUCKET: bucket, ALLOW_UNAUTHENTICATED_DRIVE: "1" },
  );
}
type Pending = { path: string; cleanup_revision: string | null };
type Listing = {
  files: { path: string; etag: string }[];
  pending_deletions?: Pending[];
  truncated: boolean;
  cursor?: string;
};
async function list(bucket: Bucket, suffix = "") {
  return (await (
    await call(bucket, "GET", "/api/drive/list" + suffix)
  ).json()) as Listing;
}
async function pending(bucket: Bucket) {
  return (await list(bucket)).pending_deletions?.[0];
}
async function failedFolderMove(bucket: Bucket) {
  expect(
    (
      await call(bucket, "PUT", "/api/drive/file/stuck%2Ffile", "only copy", {
        "if-none-match": "*",
      })
    ).status,
  ).toBe(201);
  const entries = (await list(bucket)).files.map(({ path, etag }) => ({
    path,
    etag,
  }));
  bucket.failCleanup = true;
  const response = await call(bucket, "POST", "/api/drive/folder", {
    operation: "rename",
    source_path: "stuck/",
    destination_path: "retained/",
    entries,
  });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: "folder_operation_incomplete",
    failed_path: "stuck/file",
  });
  bucket.failCleanup = false;
}

describe("explicit Drive pending deletion recovery", () => {
  test("selected marker inspection is read-only and discloses no internal validator", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    const entry = (await pending(bucket))!,
      before = bucket.effects;
    const response = await call(
      bucket,
      "GET",
      "/api/drive/cleanup?path=" +
        encodeURIComponent(entry.path) +
        "&cleanup_revision=" +
        entry.cleanup_revision,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      recoverable: true,
      path: entry.path,
      cleanup_revision: entry.cleanup_revision,
    });
    expect(bucket.effects).toBe(before);
  });

  test("a real failed folder cleanup can be listed, explicitly finished, and the path reused", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    expect(
      (await call(bucket, "GET", "/api/drive/file/stuck%2Ffile")).status,
    ).toBe(404);
    expect(
      await (
        await call(bucket, "GET", "/api/drive/file/retained%2Ffile")
      ).text(),
    ).toBe("only copy");
    const entry = await pending(bucket);
    expect(entry?.path).toBe("stuck/file");
    expect(entry?.cleanup_revision).toMatch(/^[0-9a-f]{64}$/u);
    const finished = await call(bucket, "POST", "/api/drive/cleanup", entry);
    expect(finished.status).toBe(200);
    expect(await finished.json()).toMatchObject({
      ok: true,
      path: "stuck/file",
    });
    expect(await pending(bucket)).toBeUndefined();
    expect(
      (
        await call(bucket, "PUT", "/api/drive/file/stuck%2Ffile", "new file", {
          "if-none-match": "*",
        })
      ).status,
    ).toBe(201);
    expect(
      await (
        await call(bucket, "GET", "/api/drive/file/retained%2Ffile")
      ).text(),
    ).toBe("only copy");
  });

  test("pending inventory never returns the marker nonce or its current ETag", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    const marker = bucket.data.get("drive/stuck/file")!;
    const inventory = await list(bucket);
    expect(inventory.files.some((file) => file.path === "stuck/file")).toBe(
      false,
    );
    expect(Object.keys(inventory.pending_deletions![0]!).sort()).toEqual([
      "cleanup_revision",
      "path",
    ]);
    expect(JSON.stringify(inventory.pending_deletions)).not.toContain(
      marker.etag,
    );
    expect(JSON.stringify(inventory.pending_deletions)).not.toContain(
      new TextDecoder().decode(marker.bytes),
    );
    const entry = inventory.pending_deletions![0]!;
    const before = bucket.effects;
    expect(
      (
        await call(bucket, "PUT", "/api/drive/file/stuck%2Ffile", "bad", {
          "if-match": '"' + entry.cleanup_revision + '"',
        })
      ).status,
    ).toBe(412);
    expect(bucket.effects).toBe(before);
  });

  test("ordinary replacement and same-ETag metadata-only removal of the flag reject without effects", async () => {
    for (const metadataOnly of [false, true]) {
      const bucket = new Bucket();
      await failedFolderMove(bucket);
      const entry = await pending(bucket);
      if (metadataOnly) {
        const marker = bucket.data.get("drive/stuck/file")!;
        bucket.data.set("drive/stuck/file", { ...marker, options: undefined });
      } else await bucket.put("drive/stuck/file", "replacement file");
      const bytes = bucket.data.get("drive/stuck/file")!.bytes.slice();
      const before = bucket.effects;
      expect(
        (await call(bucket, "POST", "/api/drive/cleanup", entry)).status,
      ).toBe(409);
      expect(bucket.effects).toBe(before);
      expect(bucket.data.get("drive/stuck/file")!.bytes).toEqual(bytes);
    }
  });

  test("another failed cleanup advances its marker revision and requires a fresh explicit attempt", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    const old = await pending(bucket);
    bucket.failCleanup = true;
    expect((await call(bucket, "POST", "/api/drive/cleanup", old)).status).toBe(
      503,
    );
    const fresh = await pending(bucket);
    expect(fresh?.cleanup_revision).not.toBe(old?.cleanup_revision);
    const before = bucket.effects;
    expect((await call(bucket, "POST", "/api/drive/cleanup", old)).status).toBe(
      412,
    );
    expect(bucket.effects).toBe(before);
    bucket.failCleanup = false;
    expect(
      (await call(bucket, "POST", "/api/drive/cleanup", fresh)).status,
    ).toBe(200);
    expect(await pending(bucket)).toBeUndefined();
  });

  test("a different-content writer between inspection and CAS survives with no cleanup effect", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    const entry = await pending(bucket);
    bucket.beforePut = async (key, options) => {
      if (
        key === "drive/stuck/file" &&
        options?.customMetadata?.["takos-storage-deleting"] === "1"
      ) {
        bucket.beforePut = undefined;
        await bucket.put(key, "concurrent replacement");
      }
    };
    const before = bucket.effects;
    expect(
      (await call(bucket, "POST", "/api/drive/cleanup", entry)).status,
    ).toBe(412);
    expect(bucket.effects).toBe(before + 1);
    expect(
      await (await call(bucket, "GET", "/api/drive/file/stuck%2Ffile")).text(),
    ).toBe("concurrent replacement");
  });

  test("cleanup changes the nonce before physical removal, rejecting stale and create-only writers", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    const entry = await pending(bucket),
      oldEtag = bucket.data.get("drive/stuck/file")!.etag;
    const statuses: number[] = [];
    bucket.beforeDelete = async (key) => {
      if (key !== "drive/stuck/file") return;
      bucket.beforeDelete = undefined;
      statuses.push(
        (
          await call(bucket, "PUT", "/api/drive/file/stuck%2Ffile", "late", {
            "if-match": oldEtag,
          })
        ).status,
      );
      statuses.push(
        (
          await call(bucket, "PUT", "/api/drive/file/stuck%2Ffile", "late", {
            "if-none-match": "*",
          })
        ).status,
      );
    };
    expect(
      (await call(bucket, "POST", "/api/drive/cleanup", entry)).status,
    ).toBe(200);
    expect(statuses).toEqual([412, 412]);
    expect(
      (await call(bucket, "GET", "/api/drive/file/stuck%2Ffile")).status,
    ).toBe(404);
  });

  test("legacy empty and unknown marker bodies require operator review without mutation", async () => {
    for (const body of ["", "x".repeat(36)]) {
      const bucket = new Bucket();
      await bucket.put("drive/legacy", body, {
        customMetadata: { "takos-storage-deleting": "1" },
      });
      const entry = await pending(bucket);
      expect(entry?.path).toBe("legacy");
      if (body === "") expect(entry?.cleanup_revision).toBeNull();
      const before = bucket.effects;
      const response = await call(bucket, "POST", "/api/drive/cleanup", {
        path: "legacy",
        cleanup_revision: entry?.cleanup_revision ?? "0".repeat(64),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "cleanup_requires_operator_review",
      });
      expect(bucket.effects).toBe(before);
      expect(
        new TextDecoder().decode(bucket.data.get("drive/legacy")!.bytes),
      ).toBe(body);
    }
  });

  test("marker inventory retains raw cursor traversal beyond the first physical page", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    bucket.pageSize = 1;
    const first = await list(bucket);
    expect(first.files.map((file) => file.path)).toEqual(["retained/file"]);
    expect(first.truncated).toBe(true);
    const second = await list(
      bucket,
      "?cursor=" + encodeURIComponent(first.cursor!),
    );
    expect(second.pending_deletions?.map((entry) => entry.path)).toEqual([
      "stuck/file",
    ]);
    expect(second.truncated).toBe(false);
    expect(
      (
        await call(
          bucket,
          "POST",
          "/api/drive/cleanup",
          second.pending_deletions![0],
        )
      ).status,
    ).toBe(200);
  });

  test("invalid requests and missing auth configuration cannot mutate data", async () => {
    const bucket = new Bucket();
    await failedFolderMove(bucket);
    const entry = await pending(bucket),
      before = bucket.effects;
    for (const input of [
      {},
      [],
      { ...entry, path: "" },
      { ...entry, path: "../private" },
      { ...entry, path: "/private" },
      { ...entry, cleanup_revision: '"etag"' },
    ])
      expect(
        (await call(bucket, "POST", "/api/drive/cleanup", input)).status,
      ).toBe(400);
    expect(
      (
        await call(bucket, "POST", "/api/drive/cleanup", {
          ...entry,
          padding: "x".repeat(8192),
        })
      ).status,
    ).toBe(413);
    expect((await call(bucket, "PUT", "/api/drive/cleanup")).status).toBe(405);
    expect(
      (
        await worker.fetch(
          new Request("https://storage.fixture/api/drive/cleanup", {
            method: "POST",
            body: JSON.stringify(entry),
          }),
          { BUCKET: bucket },
        )
      ).status,
    ).toBe(503);
    expect(bucket.effects).toBe(before);
    expect(
      (
        await call(bucket, "POST", "/api/drive/cleanup", {
          ...entry,
          path: "absent",
        })
      ).status,
    ).toBe(404);
    expect(bucket.effects).toBe(before);
  });
});
