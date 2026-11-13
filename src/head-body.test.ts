// Synthetic UserInfo and bucket only; the production authorization parser runs.
import { describe, expect, test } from "bun:test";
import { createStorageWorker } from "./worker.ts";
import type { Env, R2Bucket, R2Object, R2ObjectBody } from "./types.ts";

const bytes = new Uint8Array([1, 2, 3]);
const etag = '"head-fixture"';

class ProbeBucket implements R2Bucket {
  readonly objects = new Map<string, R2Object>();
  readonly heads: string[] = [];
  readonly gets: string[] = [];
  readonly bodies: ReadableStream[] = [];
  pulls = 0;
  cancels = 0;

  seed(key: string, deleted = false) {
    this.objects.set(key, {
      key,
      size: bytes.length,
      uploaded: new Date(0),
      httpEtag: etag,
      httpMetadata: { contentType: "text/plain" },
      ...(deleted ? { customMetadata: { "takos-storage-deleting": "1" } } : {}),
    });
  }

  async head(key: string): Promise<R2Object | null> {
    this.heads.push(key);
    return this.objects.get(key) ?? null;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    this.gets.push(key);
    const metadata = this.objects.get(key);
    if (!metadata) return null;
    let sent = false;
    const body = new ReadableStream({
      pull: (controller) => {
        this.pulls++;
        if (sent) controller.close();
        else {
          sent = true;
          controller.enqueue(bytes.slice());
        }
      },
      cancel: () => {
        this.cancels++;
      },
    });
    this.bodies.push(body);
    return {
      ...metadata,
      body,
      arrayBuffer: () => new Response(body).arrayBuffer(),
    };
  }

  async put(): Promise<never> {
    throw new Error("unexpected write");
  }
  async delete(): Promise<never> {
    throw new Error("unexpected delete");
  }
  async list() {
    return { objects: [], truncated: false };
  }
}

const worker = createStorageWorker(async (_input, init) => {
  const token = new Headers(init?.headers).get("authorization");
  return Response.json({
    token_use: "interface_oauth",
    sub: "principal_storage",
    aud: "https://storage.example/o",
    scope:
      token === "Bearer taksrv_head_read"
        ? "storage.object.read"
        : "storage.object.write",
    takosumi: {
      workspace_id: "workspace_a",
      capsule_id: "capsule_storage",
      interface_id: "interface_storage_object",
      interface_binding_id: "binding_a",
      interface_resolved_revision: 4,
    },
  });
});

function env(bucket: R2Bucket): Env {
  return {
    BUCKET: bucket,
    APP_URL: "https://storage.example",
    OIDC_ISSUER_URL: "https://accounts.example",
    APP_WORKSPACE_ID: "workspace_a",
    APP_CAPSULE_ID: "capsule_storage",
    ALLOW_UNAUTHENTICATED_DRIVE: "1",
  };
}

for (const route of [
  {
    path: "/o/note.txt",
    key: "interface-bindings/binding_a/note.txt",
    type: "text/plain",
  },
  {
    path: "/api/drive/file/note.txt",
    key: "drive/note.txt",
    type: "application/octet-stream",
  },
]) {
  const request = (method: string, headers: Record<string, string> = {}) =>
    new Request(`https://storage.example${route.path}`, {
      method,
      headers: { authorization: "Bearer taksrv_head_read", ...headers },
    });

  describe(`${route.path} read body lifetime`, () => {
    test("HEAD uses metadata only and retains GET headers and conditional behavior", async () => {
      const bucket = new ProbeBucket();
      bucket.seed(route.key);
      try {
        const response = await worker.fetch(
          request("HEAD", { "if-none-match": etag }),
          env(bucket),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("etag")).toBe(etag);
        expect(response.headers.get("content-type")).toBe(route.type);
        expect(response.headers.get("content-disposition")).toStartWith(
          "attachment",
        );
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-security-policy")).toBe(
          "default-src 'none'; sandbox",
        );
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        if (route.key.startsWith("drive/"))
          expect(response.headers.get("x-takos-storage-content-type")).toBe(
            "text/plain",
          );
        expect(await response.text()).toBe("");
        expect({
          heads: bucket.heads,
          gets: bucket.gets,
          bodies: bucket.bodies.length,
          pulls: bucket.pulls,
          cancels: bucket.cancels,
        }).toEqual({
          heads: [route.key],
          gets: [],
          bodies: 0,
          pulls: 0,
          cancels: 0,
        });
      } finally {
        // Clean up the deliberately open counterexample stream on the old route.
        await Promise.all(bucket.bodies.map((body) => body.cancel()));
      }
    });

    test("GET still returns the original bytes and validators", async () => {
      const bucket = new ProbeBucket();
      bucket.seed(route.key);
      const response = await worker.fetch(
        request("GET", { "if-none-match": etag }),
        env(bucket),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("content-type")).toBe(route.type);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(bucket.heads).toEqual([]);
      expect(bucket.gets).toEqual([route.key]);
      expect(bucket.pulls).toBe(2);
      expect(bucket.cancels).toBe(0);
    });

    for (const deleted of [false, true]) {
      test(`HEAD retains ${deleted ? "tombstone" : "missing"} 404 without creating a body`, async () => {
        const bucket = new ProbeBucket();
        if (deleted) bucket.seed(route.key, true);
        try {
          const response = await worker.fetch(request("HEAD"), env(bucket));
          expect(response.status).toBe(404);
          expect(bucket.heads).toEqual([route.key]);
          expect(bucket.gets).toEqual([]);
          expect(bucket.bodies).toHaveLength(0);
          expect(bucket.pulls).toBe(0);
        } finally {
          await Promise.all(bucket.bodies.map((body) => body.cancel()));
        }
      });
    }

    test("HEAD authentication/permission denial reaches neither R2 method", async () => {
      const bucket = new ProbeBucket();
      bucket.seed(route.key);
      const deniedEnv = {
        ...env(bucket),
        ALLOW_UNAUTHENTICATED_DRIVE: undefined,
        OIDC_CLIENT_ID: "fixture-client",
        APP_SESSION_SECRET: "fixture-session-secret",
      };
      const response = await worker.fetch(
        request("HEAD", { authorization: "Bearer taksrv_head_write" }),
        deniedEnv,
      );
      expect(response.status).toBe(401);
      expect(bucket.heads).toEqual([]);
      expect(bucket.gets).toEqual([]);
      expect(bucket.bodies).toHaveLength(0);
    });
  });
}
