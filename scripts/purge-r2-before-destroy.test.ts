import { describe, expect, test } from "bun:test";

import {
  purgeR2BucketBeforeDestroy,
  type PurgeFetch,
} from "./purge-r2-before-destroy.ts";

function api(payload: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...payload });
}

describe("storage R2 pre-destroy", () => {
  test("reads the reviewed output, purges bounded pages, and removes the cleaner", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const purgePages = [
      { ok: true, deleted: 1000, done: false },
      { ok: true, deleted: 2, done: false },
      { ok: true, deleted: 0, done: true },
    ];
    let uploadedMetadata: string | undefined;
    let uploadedWorker: string | undefined;
    const fetchImpl: PurgeFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (url.endsWith("/workers/subdomain") && method === "GET") {
        return api({ result: { subdomain: "fixture-account" } });
      }
      if (url.includes("/workers/scripts/") && method === "PUT") {
        const form = init?.body as FormData;
        uploadedMetadata = await (form.get("metadata") as Blob).text();
        uploadedWorker = await (form.get("worker.mjs") as Blob).text();
        return api();
      }
      if (url.endsWith("/subdomain") && method === "POST") return api();
      if (url.endsWith(".workers.dev/purge") && method === "POST") {
        return Response.json(purgePages.shift());
      }
      if (url.includes("/workers/scripts/") && method === "DELETE") {
        return api();
      }
      return new Response("unexpected request", { status: 500 });
    };

    const result = await purgeR2BucketBeforeDestroy(
      {
        CLOUDFLARE_API_TOKEN: "provider-token",
        TAKOSUMI_OUTPUTS_JSON: JSON.stringify({
          cloudflare_account_id: "account-a",
          object_bucket_name: "workspace-storage-objects",
        }),
        TAKOS_STORAGE_CLOUDFLARE_API_MODE: "direct",
        CLOUDFLARE_API_BASE_URL: "https://api.example.test/client/v4/",
      },
      fetchImpl,
      async () => undefined,
    );

    expect(result).toEqual({
      kind: "takos-storage.r2-pre-destroy@v1",
      status: "succeeded",
      bucketName: "workspace-storage-objects",
      deleted: 1002,
      cleanerRemoved: true,
    });
    expect(uploadedMetadata).toContain(
      '"bucket_name":"workspace-storage-objects"',
    );
    expect(uploadedWorker).toContain("EXPECTED_TOKEN_SHA256");
    expect(uploadedWorker).not.toContain("provider-token");
    expect(result).not.toHaveProperty("token");
    expect(
      calls.filter((call) => call.url.endsWith(".workers.dev/purge")),
    ).toHaveLength(3);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  test("accepts tofu output -json shape for direct self-host use", async () => {
    const seen: string[] = [];
    const fetchImpl: PurgeFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      seen.push(url);
      if (url.endsWith("/workers/subdomain")) {
        return api({ result: { subdomain: "fixture" } });
      }
      if (init?.method === "PUT" || url.endsWith("/subdomain")) return api();
      if (url.endsWith(".workers.dev/purge")) {
        return Response.json({ ok: true, deleted: 0, done: true });
      }
      if (init?.method === "DELETE") return api();
      return new Response("unexpected", { status: 500 });
    };
    const result = await purgeR2BucketBeforeDestroy(
      {
        CF_API_TOKEN: "provider-token",
        CLOUDFLARE_ACCOUNT_ID: "account-a",
        TAKOS_STORAGE_CLOUDFLARE_API_MODE: "direct",
        TAKOSUMI_OUTPUTS_JSON: JSON.stringify({
          object_bucket_name: { value: "direct-bucket", type: "string" },
        }),
      },
      fetchImpl,
      async () => undefined,
    );
    expect(result.bucketName).toBe("direct-bucket");
    expect(seen.some((url) => url.includes("takos-storage-clean-"))).toBe(true);
  });

  test("always removes an uploaded cleaner when purge fails", async () => {
    let removed = false;
    const fetchImpl: PurgeFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/workers/subdomain")) {
        return api({ result: { subdomain: "fixture" } });
      }
      if (init?.method === "PUT" || url.endsWith("/subdomain")) return api();
      if (url.endsWith(".workers.dev/purge")) {
        return Response.json({ ok: false, deleted: "invalid", done: false });
      }
      if (init?.method === "DELETE") {
        removed = true;
        return api();
      }
      return new Response("unexpected", { status: 500 });
    };
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "account-a",
          TAKOS_STORAGE_CLOUDFLARE_API_MODE: "direct",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
        },
        fetchImpl,
        async () => undefined,
      ),
    ).rejects.toThrow("invalid result");
    expect(removed).toBe(true);
  });

  test("removes the deterministic cleaner when the upload response is lost", async () => {
    let removed = false;
    const fetchImpl: PurgeFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/workers/subdomain")) {
        return api({ result: { subdomain: "fixture" } });
      }
      if (init?.method === "PUT") {
        throw new Error("connection reset after commit");
      }
      if (init?.method === "DELETE") {
        removed = true;
        return api();
      }
      return new Response("unexpected", { status: 500 });
    };

    await expect(
      purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "account-a",
          TAKOS_STORAGE_CLOUDFLARE_API_MODE: "direct",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
        },
        fetchImpl,
        async () => undefined,
      ),
    ).rejects.toThrow("connection reset after commit");
    expect(removed).toBe(true);
  });

  test("uses empty or official default provider configuration as direct Cloudflare", async () => {
    for (const configuration of [
      {},
      { base_url: "https://api.cloudflare.com/client/v4/" },
    ]) {
      const urls: string[] = [];
      const fetchImpl: PurgeFetch = async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        urls.push(url);
        const method = init?.method ?? "GET";
        if (url.endsWith("/workers/subdomain") && method === "GET") {
          return api({ result: { subdomain: "fixture-account" } });
        }
        if (method === "PUT" || url.endsWith("/subdomain")) return api();
        if (url.endsWith(".workers.dev/purge") && method === "POST") {
          return Response.json({ ok: true, deleted: 0, done: true });
        }
        if (method === "DELETE") return api();
        return new Response("unexpected", { status: 500 });
      };

      const result = await purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "account-a",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            format: "takosumi.provider-configurations@v1",
            providers: [
              {
                provider: "registry.opentofu.org/cloudflare/cloudflare",
                alias: null,
                configuration,
              },
            ],
          }),
        },
        fetchImpl,
        async () => undefined,
      );

      expect(result.status).toBe("succeeded");
      expect(urls).toContain(
        "https://api.cloudflare.com/client/v4/accounts/account-a/workers/subdomain",
      );
      expect(urls.some((url) => url.endsWith(".workers.dev/purge"))).toBe(true);
    }
  });

  test("uses a custom provider API and its returned invocation origin", async () => {
    const urls: string[] = [];
    const fetchImpl: PurgeFetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      urls.push(url);
      const method = init?.method ?? "GET";
      if (url.endsWith("/subdomain") && method === "POST") {
        return api({
          result: { hostname: "storage-cleaner.app.takosumi.test" },
        });
      }
      if (
        url === "https://storage-cleaner.app.takosumi.test/purge" &&
        method === "POST"
      ) {
        return Response.json({ ok: true, deleted: 0, done: true });
      }
      if (method === "PUT" || method === "DELETE") return api();
      return new Response("unexpected", { status: 500 });
    };

    const result = await purgeR2BucketBeforeDestroy(
      {
        CLOUDFLARE_API_TOKEN: "provider-token",
        TAKOSUMI_OUTPUTS_JSON: JSON.stringify({
          cloudflare_account_id: { value: "virtual-account" },
          object_bucket_name: { value: "managed-bucket" },
        }),
        TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
          format: "takosumi.provider-configurations@v1",
          providers: [
            {
              provider: "registry.opentofu.org/cloudflare/cloudflare",
              alias: null,
              configuration: {
                base_url:
                  "https://app.takosumi.test/compat/cloudflare/client/v4",
              },
            },
          ],
        }),
      },
      fetchImpl,
      async () => undefined,
    );

    expect(result.status).toBe("succeeded");
    expect(urls).toContain("https://storage-cleaner.app.takosumi.test/purge");
    expect(
      urls
        .filter((url) => url.includes("/accounts/virtual-account/"))
        .every((url) =>
          url.startsWith(
            "https://app.takosumi.test/compat/cloudflare/client/v4/",
          ),
        ),
    ).toBe(true);
    expect(urls.some((url) => url.includes("workers/subdomain"))).toBe(false);
    expect(urls.some((url) => url.includes("api.cloudflare.com"))).toBe(false);
  });

  test("rejects a missing provider envelope before any provider call", async () => {
    let called = false;
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "account-a",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
        },
        async () => {
          called = true;
          return api();
        },
      ),
    ).rejects.toThrow("TAKOSUMI_PROVIDER_CONFIGS_JSON is required");
    expect(called).toBe(false);
  });

  test("rejects an envelope without the default Cloudflare entry", async () => {
    let called = false;
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "account-a",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            format: "takosumi.provider-configurations@v1",
            providers: [
              {
                provider: "registry.opentofu.org/cloudflare/cloudflare",
                alias: "secondary",
                configuration: {},
              },
            ],
          }),
        },
        async () => {
          called = true;
          return api();
        },
      ),
    ).rejects.toThrow("must contain the default Cloudflare provider entry");
    expect(called).toBe(false);
  });

  test("does not mix an explicit direct invocation with a provider envelope", async () => {
    let called = false;
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "account-a",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
          TAKOS_STORAGE_CLOUDFLARE_API_MODE: "direct",
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            format: "takosumi.provider-configurations@v1",
            providers: [
              {
                provider: "registry.opentofu.org/cloudflare/cloudflare",
                alias: null,
                configuration: {},
              },
            ],
          }),
        },
        async () => {
          called = true;
          return api();
        },
      ),
    ).rejects.toThrow("direct Cloudflare mode must not consume");
    expect(called).toBe(false);
  });

  test("rejects retired map and nested secret config before any provider call", async () => {
    let called = false;
    const baseEnv = {
      CLOUDFLARE_API_TOKEN: "provider-token",
      CLOUDFLARE_ACCOUNT_ID: "account-a",
      TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
    } as const;
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          ...baseEnv,
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            "cloudflare/cloudflare": {
              base_url: "https://app.takosumi.test/compat/cloudflare/client/v4",
            },
          }),
        },
        async () => {
          called = true;
          return api();
        },
      ),
    ).rejects.toThrow("TAKOSUMI_PROVIDER_CONFIGS_JSON.format");
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          ...baseEnv,
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            format: "takosumi.provider-configurations@v1",
            providers: [
              {
                provider: "registry.opentofu.org/cloudflare/cloudflare",
                alias: null,
                configuration: {
                  base_url:
                    "https://app.takosumi.test/compat/cloudflare/client/v4",
                  nested: { api_token: "must-not-be-dispatched" },
                },
              },
            ],
          }),
        },
        async () => {
          called = true;
          return api();
        },
      ),
    ).rejects.toThrow("must contain only non-secret provider configuration");
    expect(called).toBe(false);
  });

  test("custom provider mode removes the cleaner when no invocation origin is returned", async () => {
    let removed = false;
    const fetchImpl: PurgeFetch = async (_input, init) => {
      if (init?.method === "DELETE") removed = true;
      return api();
    };
    await expect(
      purgeR2BucketBeforeDestroy(
        {
          CLOUDFLARE_API_TOKEN: "provider-token",
          CLOUDFLARE_ACCOUNT_ID: "virtual-account",
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
          TAKOSUMI_PROVIDER_CONFIGS_JSON: JSON.stringify({
            format: "takosumi.provider-configurations@v1",
            providers: [
              {
                provider: "registry.opentofu.org/cloudflare/cloudflare",
                alias: null,
                configuration: {
                  base_url:
                    "https://app.takosumi.test/compat/cloudflare/client/v4",
                },
              },
            ],
          }),
        },
        fetchImpl,
        async () => undefined,
      ),
    ).rejects.toThrow("did not return the temporary cleaner invocation origin");
    expect(removed).toBe(true);
  });
});
