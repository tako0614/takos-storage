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
        CLOUDFLARE_ACCOUNT_ID: "account-a",
        TAKOSUMI_OUTPUTS_JSON: JSON.stringify({
          object_bucket_name: "workspace-storage-objects",
        }),
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
          TAKOS_STORAGE_R2_BUCKET_NAME: "bucket-a",
        },
        fetchImpl,
        async () => undefined,
      ),
    ).rejects.toThrow("connection reset after commit");
    expect(removed).toBe(true);
  });
});
