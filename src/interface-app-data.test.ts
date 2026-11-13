import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createStorageWorker } from "./worker.ts";
import type {
  Env,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2Objects,
  R2PutOptions,
} from "./types.ts";

// The R2 dependency double follows the existing Worker test fixture. Assertions
// below use the public HTTP seam; native R2 interoperability is checked separately.
class MemoryBucket implements R2Bucket {
  pageSize = 1000;
  readonly store = new Map<
    string,
    {
      data: Uint8Array;
      contentType: string;
      customMetadata?: Record<string, string>;
    }
  >();

  async head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.data.byteLength,
      uploaded: new Date(0),
      httpEtag: `"${createHash("md5").update(entry.data).digest("hex")}"`,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.customMetadata,
    };
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.data.byteLength,
      uploaded: new Date(0),
      httpEtag: `"${createHash("md5").update(entry.data).digest("hex")}"`,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.customMetadata,
      body: new Response(entry.data.slice().buffer).body as ReadableStream,
      arrayBuffer: async () => entry.data.buffer as ArrayBuffer,
    };
  }

  async put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null> {
    const onlyIf = options?.onlyIf;
    const ifMatch =
      onlyIf instanceof Headers
        ? onlyIf.get("if-match")
        : onlyIf?.etagMatches === undefined
          ? undefined
          : `"${onlyIf.etagMatches}"`;
    const ifNone =
      onlyIf instanceof Headers
        ? onlyIf.get("if-none-match")
        : onlyIf?.etagDoesNotMatch;
    if (ifMatch != null && (await this.head(key))?.httpEtag !== ifMatch)
      return null;
    if (ifNone === "*" && this.store.has(key)) return null;
    let data: Uint8Array;
    if (typeof value === "string") data = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value);
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    this.store.set(key, {
      data,
      contentType:
        options?.httpMetadata?.contentType ?? "application/octet-stream",
      customMetadata: options?.customMetadata,
    });
    return (await this.head(key)) as R2Object;
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(key);
    }
  }

  async list(options: R2ListOptions = {}): Promise<R2Objects> {
    const prefix = options.prefix ?? "";
    const offset = options.cursor ? Number(options.cursor) : 0;
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    const page = keys.slice(
      offset,
      offset + Math.min(options.limit ?? 1000, this.pageSize),
    );
    const objects = await Promise.all(
      page.map(async (key) => {
        const object = (await this.head(key))!;
        if (!options.include?.includes("customMetadata"))
          delete object.customMetadata;
        return object;
      }),
    );
    const next = offset + page.length;
    return {
      objects,
      truncated: next < keys.length,
      ...(next < keys.length ? { cursor: String(next) } : {}),
    };
  }
}

const NAMESPACE = `appd_${"a".repeat(64)}`;
function appDataClaims(subject: string, bindingId: string, permission: string) {
  return {
    token_use: "interface_app_data",
    sub: subject,
    aud: "https://storage.example/o",
    scope: permission,
    takosumi: {
      capsule_id: "capsule_storage",
      interface_id: "interface_storage_object",
      interface_binding_id: bindingId,
      interface_resolved_revision: 4,
      app_data: {
        contract: "takosumi.interface-app-data/v1",
        namespace_id: NAMESPACE,
        consumer_capsule_id: "capsule_office",
        provider_capsule_id: "capsule_storage",
        ownership_epoch: 0,
        provider_ownership_epoch: 0,
        app_role: subject === "principal_owner" ? "owner" : "member",
        interface_link_id: "link_office_storage",
        interface_link_generation: 1,
        interface_binding_generation: 1,
        interface_generation: 1,
      },
    },
  };
}

function fixture() {
  const bucket = new MemoryBucket();
  let bucketCalls = 0;
  let userInfoCalls = 0;
  const observedBucket: R2Bucket = {
    head: (...args) => {
      bucketCalls += 1;
      return bucket.head(...args);
    },
    get: (...args) => {
      bucketCalls += 1;
      return bucket.get(...args);
    },
    put: (...args) => {
      bucketCalls += 1;
      return bucket.put(...args);
    },
    delete: (...args) => {
      bucketCalls += 1;
      return bucket.delete(...args);
    },
    list: (...args) => {
      bucketCalls += 1;
      return bucket.list(...args);
    },
  };
  const env: Env = {
    BUCKET: observedBucket,
    APP_URL: "https://storage.example",
    APP_CAPSULE_ID: "capsule_storage",
    OIDC_ISSUER_URL: "https://accounts.example",
  };
  const claims = new Map<string, unknown>([
    [
      "taksrv_fixture_owner_write",
      appDataClaims("principal_owner", "binding_owner", "storage.object.write"),
    ],
    [
      "taksrv_fixture_owner_read",
      appDataClaims("principal_owner", "binding_owner", "storage.object.read"),
    ],
    [
      "taksrv_fixture_member_write",
      appDataClaims(
        "principal_member",
        "binding_member",
        "storage.object.write",
      ),
    ],
    [
      "taksrv_fixture_member_read",
      appDataClaims(
        "principal_member",
        "binding_member",
        "storage.object.read",
      ),
    ],
  ]);
  const worker = createStorageWorker(async (input, init) => {
    userInfoCalls += 1;
    expect(String(input)).toBe("https://accounts.example/oauth/userinfo");
    expect(init?.redirect).toBe("manual");
    const token = /^Bearer (.+)$/u.exec(
      new Headers(init?.headers).get("authorization") ?? "",
    )?.[1];
    const body = token ? claims.get(token) : undefined;
    return body ? Response.json(body) : Response.json({}, { status: 401 });
  });
  const request = (
    token: string,
    method: string,
    key: string,
    body?: string,
    headers?: HeadersInit,
  ) =>
    worker.fetch(
      new Request(`https://storage.example/o/${key}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...Object.fromEntries(new Headers(headers)),
        },
        ...(body === undefined ? {} : { body }),
      }),
      env,
    );
  return {
    claims,
    request,
    worker,
    env,
    bucketCalls: () => bucketCalls,
    userInfoCalls: () => userInfoCalls,
  };
}

test("current app-shared authority lets different Principal Bindings read one document", async () => {
  const f = fixture();
  const written = await f.request(
    "taksrv_fixture_owner_write",
    "PUT",
    "office/document",
    "first draft",
    { "if-none-match": "*" },
  );
  expect(written.status).toBe(201);
  const read = await f.request(
    "taksrv_fixture_member_read",
    "GET",
    "office/document",
  );
  expect(read.status).toBe(200);
  expect(await read.text()).toBe("first draft");
});

test("shared writers retain the original content ETag and reject a stale update without effects", async () => {
  const f = fixture();
  expect(
    (
      await f.request("taksrv_fixture_owner_write", "PUT", "doc", "first", {
        "if-none-match": "*",
      })
    ).status,
  ).toBe(201);
  const read = await f.request("taksrv_fixture_member_read", "GET", "doc");
  expect(read.status).toBe(200);
  const etag = read.headers.get("etag");
  expect(etag).not.toBeNull();
  expect(
    (
      await f.request("taksrv_fixture_member_write", "PUT", "doc", "newer", {
        "if-match": etag!,
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await f.request("taksrv_fixture_owner_write", "PUT", "doc", "stale", {
        "if-match": etag!,
      })
    ).status,
  ).toBe(412);
  expect(
    await (await f.request("taksrv_fixture_owner_read", "GET", "doc")).text(),
  ).toBe("newer");
});

test("personal Bindings and other consumer app namespaces cannot read shared objects", async () => {
  const f = fixture();
  expect(
    (
      await f.request("taksrv_fixture_owner_write", "PUT", "doc", "shared", {
        "if-none-match": "*",
      })
    ).status,
  ).toBe(201);
  const other = appDataClaims(
    "principal_member",
    "binding_member",
    "storage.object.read",
  );
  other.takosumi.app_data.namespace_id = `appd_${"b".repeat(64)}`;
  other.takosumi.app_data.consumer_capsule_id = "capsule_other_office";
  f.claims.set("taksrv_other_app", other);
  expect((await f.request("taksrv_other_app", "GET", "doc")).status).toBe(404);
  const personal = appDataClaims(
    "principal_owner",
    "binding_owner",
    "storage.object.read",
  );
  const personalEvidence = Object.fromEntries(
    Object.entries(personal.takosumi).filter(([key]) => key !== "app_data"),
  );
  f.claims.set("taksrv_personal", {
    ...personal,
    token_use: "interface_oauth",
    takosumi: personalEvidence,
  });
  expect((await f.request("taksrv_personal", "GET", "doc")).status).toBe(404);
  const personalWrite = {
    ...personal,
    token_use: "interface_oauth",
    scope: "storage.object.write",
    takosumi: personalEvidence,
  };
  f.claims.set("taksrv_personal_write", personalWrite);
  expect(
    (
      await f.request("taksrv_personal_write", "PUT", "doc", "personal", {
        "if-none-match": "*",
      })
    ).status,
  ).toBe(201);
  expect(await (await f.request("taksrv_personal", "GET", "doc")).text()).toBe(
    "personal",
  );
  expect(
    await (await f.request("taksrv_fixture_member_read", "GET", "doc")).text(),
  ).toBe("shared");
});

test("permission mismatch and current UserInfo refusal cause no bucket access", async () => {
  const f = fixture();
  expect(
    (
      await f.request("taksrv_fixture_member_read", "PUT", "doc", "denied", {
        "if-none-match": "*",
      })
    ).status,
  ).toBe(401);
  expect(f.bucketCalls()).toBe(0);
  expect(
    (
      await f.request("taksrv_fixture_owner_write", "PUT", "doc", "kept", {
        "if-none-match": "*",
      })
    ).status,
  ).toBe(201);
  const before = f.bucketCalls();
  f.claims.delete("taksrv_fixture_member_read");
  expect(
    (await f.request("taksrv_fixture_member_read", "GET", "doc")).status,
  ).toBe(401);
  expect(f.bucketCalls()).toBe(before);
  expect(
    await (await f.request("taksrv_fixture_owner_read", "GET", "doc")).text(),
  ).toBe("kept");
});

test("app-data evidence is closed and cannot fall back to personal or Workspace authority", async () => {
  const mutations: Array<
    (claims: ReturnType<typeof appDataClaims>) => unknown
  > = [
    (c) => ({ ...c, takosumi: { ...c.takosumi, app_data: undefined } }),
    (c) => ({ ...c, takosumi: { ...c.takosumi, app_data: null } }),
    (c) => ({ ...c, token_use: "interface_oauth" }),
    (c) => ({
      ...c,
      takosumi: {
        ...c.takosumi,
        app_data: { ...c.takosumi.app_data, extra: true },
      },
    }),
    ...[
      ["contract", "takosumi.interface-app-data/v2"],
      ["namespace_id", `appd_${"A".repeat(64)}`],
      ["namespace_id", "appd_../another"],
      ["namespace_id", `appd_${"a".repeat(63)}`],
      ["consumer_capsule_id", ""],
      ["provider_capsule_id", "another_provider"],
      ["app_role", "operator"],
      ["ownership_epoch", -1],
      ["ownership_epoch", 0.5],
      ["provider_ownership_epoch", undefined],
      ["provider_ownership_epoch", -1],
      ["provider_ownership_epoch", Number.MAX_SAFE_INTEGER + 1],
      ["interface_link_id", " link"],
      ["interface_link_generation", 0],
      ["interface_binding_generation", "1"],
      ["interface_generation", Number.MAX_SAFE_INTEGER + 1],
    ].map(([key, value]) => (c: ReturnType<typeof appDataClaims>) => ({
      ...c,
      takosumi: {
        ...c.takosumi,
        app_data: { ...c.takosumi.app_data, [key as string]: value },
      },
    })),
  ];
  for (const mutate of mutations) {
    const f = fixture();
    f.claims.set(
      "taksrv_fixture_member_read",
      mutate(
        appDataClaims(
          "principal_member",
          "binding_member",
          "storage.object.read",
        ),
      ),
    );
    expect(
      (await f.request("taksrv_fixture_member_read", "GET", "doc")).status,
    ).toBe(401);
    expect(f.bucketCalls()).toBe(0);
  }
  const f = fixture();
  f.env.APP_CAPSULE_ID = undefined;
  f.env.APP_WORKSPACE_ID = "workspace_a";
  const claims = appDataClaims(
    "principal_member",
    "binding_member",
    "storage.object.read",
  );
  f.claims.set("taksrv_fixture_member_read", {
    ...claims,
    takosumi: { ...claims.takosumi, workspace_id: "workspace_a" },
  });
  expect(
    (await f.request("taksrv_fixture_member_read", "GET", "doc")).status,
  ).toBe(401);
  expect(f.bucketCalls()).toBe(0);
  expect(f.userInfoCalls()).toBe(1);
});

test("a caller-chosen namespace query does not select another app's data", async () => {
  const f = fixture();
  const otherNamespace = `appd_${"b".repeat(64)}`;
  expect(
    (
      await f.request(
        "taksrv_fixture_owner_write",
        "PUT",
        `doc?namespace_id=${otherNamespace}`,
        "mine",
        { "if-none-match": "*" },
      )
    ).status,
  ).toBe(201);
  const other = appDataClaims(
    "principal_member",
    "binding_other_app",
    "storage.object.read",
  );
  other.takosumi.app_data.namespace_id = otherNamespace;
  other.takosumi.app_data.consumer_capsule_id = "capsule_other_office";
  f.claims.set("taksrv_other_app", other);
  expect((await f.request("taksrv_other_app", "GET", "doc")).status).toBe(404);
  expect(
    await (await f.request("taksrv_fixture_owner_read", "GET", "doc")).text(),
  ).toBe("mine");
});

test("the object app-data purpose does not enable MCP authorization", async () => {
  const f = fixture();
  const claims = appDataClaims(
    "principal_member",
    "binding_member",
    "mcp.invoke",
  );
  claims.aud = "https://storage.example/mcp";
  f.claims.set("taksrv_mcp_app_data", claims);
  const result = await f.worker.fetch(
    new Request("https://storage.example/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer taksrv_mcp_app_data",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "source-fixture", version: "1" },
        },
      }),
    }),
    f.env,
  );
  expect(result.status).toBe(401);
  expect(f.bucketCalls()).toBe(0);
  expect(f.userInfoCalls()).toBe(1);
});
