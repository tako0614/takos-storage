import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  legacyMigrationWorkerSource,
  migrateLegacyBindingPrefix,
  type MigrationFetch,
} from "./migrate-r2-binding-prefix.ts";

function api(payload: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...payload });
}

interface StoredObject {
  body: Uint8Array;
  httpEtag: string;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

class MigrationBucketFixture {
  readonly objects = new Map<string, StoredObject>();
  putCount = 0;
  listedKeyOverride?: string;

  async list(options: { prefix: string }) {
    const keys = this.listedKeyOverride
      ? [this.listedKeyOverride]
      : [...this.objects.keys()].filter((key) =>
          key.startsWith(options.prefix),
        );
    return {
      objects: keys.map((key) => ({ key })),
      truncated: false,
    };
  }

  async get(key: string) {
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      ...value,
      body: value.body.slice(),
      size: value.body.byteLength,
    };
  }

  async head(key: string) {
    const value = this.objects.get(key);
    if (!value) return null;
    return {
      ...value,
      size: value.body.byteLength,
    };
  }

  async put(
    key: string,
    body: BodyInit,
    options: {
      httpMetadata?: Record<string, string>;
      customMetadata?: Record<string, string>;
      onlyIf?: { etagDoesNotMatch?: string };
    },
  ) {
    if (options.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, {
      body: bytes,
      httpEtag: `copied-${this.putCount}`,
      ...(options.httpMetadata ? { httpMetadata: options.httpMetadata } : {}),
      ...(options.customMetadata
        ? { customMetadata: options.customMetadata }
        : {}),
    });
    this.putCount += 1;
    return { key };
  }
}

async function generatedWorker(input: {
  token: string;
  legacyPrefix: string;
  bindingId: string;
}) {
  const source = legacyMigrationWorkerSource({
    tokenHash: createHash("sha256").update(input.token).digest("hex"),
    legacyPrefix: input.legacyPrefix,
    bindingId: input.bindingId,
  });
  const module = (await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  )) as {
    default: {
      fetch(
        request: Request,
        env: { BUCKET: MigrationBucketFixture },
      ): Promise<Response>;
    };
  };
  return module.default;
}

function invokeGeneratedWorker(
  worker: Awaited<ReturnType<typeof generatedWorker>>,
  bucket: MigrationBucketFixture,
  token: string,
) {
  return worker.fetch(
    new Request("https://migration.example/migrate", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{}",
    }),
    { BUCKET: bucket },
  );
}

test("legacy migration pins one binding and leaves raw keys as rollback evidence", () => {
  const source = legacyMigrationWorkerSource({
    tokenHash: "hash",
    legacyPrefix: "workspace/a/",
    bindingId: "binding/a",
  });
  expect(source).toContain('const LEGACY_PREFIX="workspace/a/"');
  expect(source).toContain("interface-bindings/binding%2Fa/");
  expect(source).toContain('onlyIf:{etagDoesNotMatch:"*"}');
  expect(source).not.toContain("BUCKET.delete(listed.key)");
  expect(source).toContain("page.cursor");
  expect(source).toContain("listed.key.startsWith(LEGACY_PREFIX)");
  expect(source).toContain("listed.key.slice(LEGACY_PREFIX.length)");
  expect(source).toContain("target.customMetadata?.[MARKER]!==source.httpEtag");
  expect(source).toContain('error:"target_conflict"');
});

test("generated Worker strips the legacy prefix, reruns idempotently, and preserves rollback data", async () => {
  const token = "migration-token";
  const sourceKey = "workspace/a/folder/object.txt";
  const targetKey = "interface-bindings/binding%2Fa/folder/object.txt";
  const bucket = new MigrationBucketFixture();
  bucket.objects.set(sourceKey, {
    body: new TextEncoder().encode("payload"),
    httpEtag: "source-etag",
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { owner: "legacy" },
  });
  const worker = await generatedWorker({
    token,
    legacyPrefix: "workspace/a/",
    bindingId: "binding/a",
  });

  const first = await invokeGeneratedWorker(worker, bucket, token);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    ok: true,
    migrated: 1,
    done: true,
  });
  expect(bucket.objects.has(sourceKey)).toBe(true);
  expect(bucket.objects.has(targetKey)).toBe(true);
  expect(
    bucket.objects.has(
      "interface-bindings/binding%2Fa/workspace/a/folder/object.txt",
    ),
  ).toBe(false);
  expect(bucket.objects.get(targetKey)?.customMetadata).toEqual({
    owner: "legacy",
    "takos-storage-legacy-etag": "source-etag",
  });
  expect(bucket.putCount).toBe(1);

  const second = await invokeGeneratedWorker(worker, bucket, token);
  expect(second.status).toBe(200);
  expect(bucket.putCount).toBe(1);
});

test("generated Worker fails closed on a conflicting target or an out-of-prefix listing", async () => {
  const token = "migration-token";
  const sourceKey = "workspace/a/object.txt";
  const targetKey = "interface-bindings/binding-a/object.txt";
  const worker = await generatedWorker({
    token,
    legacyPrefix: "workspace/a/",
    bindingId: "binding-a",
  });
  const conflicting = new MigrationBucketFixture();
  conflicting.objects.set(sourceKey, {
    body: new TextEncoder().encode("source"),
    httpEtag: "source-etag",
  });
  conflicting.objects.set(targetKey, {
    body: new TextEncoder().encode("other!"),
    httpEtag: "target-etag",
  });

  const conflict = await invokeGeneratedWorker(worker, conflicting, token);
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({
    ok: false,
    error: "target_conflict",
    source: sourceKey,
  });

  const invalidListing = new MigrationBucketFixture();
  invalidListing.listedKeyOverride = "workspace/b/object.txt";
  const invalid = await invokeGeneratedWorker(worker, invalidListing, token);
  expect(invalid.status).toBe(409);
  expect(await invalid.json()).toMatchObject({
    ok: false,
    error: "invalid_source_key",
  });
});

test("migration preserves rollback data and removes its Worker after a partial-page failure", async () => {
  let removed = false;
  let invocation = 0;
  const fetchImpl: MigrationFetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    if (url.endsWith("/workers/subdomain") && method === "GET") {
      return api({ result: { subdomain: "fixture" } });
    }
    if (url.includes("/workers/scripts/") && method === "PUT") return api();
    if (url.endsWith("/subdomain") && method === "POST") return api();
    if (url.endsWith(".workers.dev/migrate")) {
      invocation += 1;
      return invocation === 1
        ? Response.json({
            ok: true,
            migrated: 50,
            done: false,
            cursor: "page-2",
          })
        : Response.json(
            { ok: false, error: "target_conflict" },
            { status: 409 },
          );
    }
    if (method === "DELETE") {
      removed = true;
      return api();
    }
    return new Response("unexpected", { status: 500 });
  };

  await expect(
    migrateLegacyBindingPrefix(
      {
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "account",
        TAKOS_STORAGE_R2_BUCKET_NAME: "bucket",
        TAKOS_STORAGE_LEGACY_KEY_PREFIX: "workspace/a",
        TAKOS_STORAGE_INTERFACE_BINDING_ID: "binding-a",
      },
      fetchImpl,
    ),
  ).rejects.toThrow("legacy R2 migration failed: 409");
  expect(invocation).toBe(2);
  expect(removed).toBe(true);
});

test("migration loops bounded pages and always removes its temporary Worker", async () => {
  const pages = [
    { ok: true, migrated: 50, done: false, cursor: "page-2" },
    { ok: true, migrated: 2, done: false, cursor: "page-3" },
    { ok: true, migrated: 0, done: true },
  ];
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl: MigrationFetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.endsWith("/workers/subdomain") && method === "GET") {
      return api({ result: { subdomain: "fixture" } });
    }
    if (url.includes("/workers/scripts/") && method === "PUT") return api();
    if (url.endsWith("/subdomain") && method === "POST") return api();
    if (url.endsWith(".workers.dev/migrate"))
      return Response.json(pages.shift());
    if (method === "DELETE") return api();
    return new Response("unexpected", { status: 500 });
  };
  const result = await migrateLegacyBindingPrefix(
    {
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      TAKOS_STORAGE_R2_BUCKET_NAME: "bucket",
      TAKOS_STORAGE_LEGACY_KEY_PREFIX: "workspace/a",
      TAKOS_STORAGE_INTERFACE_BINDING_ID: "binding-a",
      CLOUDFLARE_API_BASE_URL: "https://api.example.test/client/v4",
    },
    fetchImpl,
  );
  expect(result.migrated).toBe(52);
  expect(
    calls.filter(({ url }) => url.endsWith(".workers.dev/migrate")),
  ).toHaveLength(3);
  expect(calls.at(-1)?.method).toBe("DELETE");
});

test("migration rejects ambiguous prefixes before making network requests", async () => {
  let called = false;
  await expect(
    migrateLegacyBindingPrefix(
      {
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "account",
        TAKOS_STORAGE_R2_BUCKET_NAME: "bucket",
        TAKOS_STORAGE_LEGACY_KEY_PREFIX: "interface-bindings/other",
        TAKOS_STORAGE_INTERFACE_BINDING_ID: "binding-a",
      },
      async () => {
        called = true;
        return api();
      },
    ),
  ).rejects.toThrow("unsafe");
  expect(called).toBe(false);
});
