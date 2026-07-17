import { expect, test } from "bun:test";

import {
  legacyMigrationWorkerSource,
  migrateLegacyBindingPrefix,
  type MigrationFetch,
} from "./migrate-r2-binding-prefix.ts";

function api(payload: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...payload });
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
  expect(source).toContain("target.customMetadata?.[MARKER]!==source.httpEtag");
  expect(source).toContain('error:"target_conflict"');
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
