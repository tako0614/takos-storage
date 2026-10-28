import { expect, test } from "bun:test";
import { createStorageWorker } from "./worker.ts";
import type { Env } from "./types.ts";

const env: Env = {
  APP_URL: "https://storage.example",
  OIDC_ISSUER_URL: "https://accounts.example",
  APP_CAPSULE_ID: "capsule_storage",
  BUCKET: {
    async get() {
      return null;
    },
    async put() {
      throw new Error("unexpected write");
    },
    async delete() {
      throw new Error("unexpected delete");
    },
    async list() {
      return { objects: [], truncated: false };
    },
  },
};

for (const [path, permission] of [
  ["/o", "storage.object.list"],
  ["/mcp", "mcp.invoke"],
]) {
  test(`${path} accepts exact Capsule evidence without a Workspace`, async () => {
    let capsuleId = "capsule_storage";
    const worker = createStorageWorker(async () =>
      Response.json({
        token_use: "interface_oauth",
        sub: "principal_storage",
        aud: `https://storage.example${path}`,
        scope: permission,
        takosumi: {
          capsule_id: capsuleId,
          interface_id: "interface_storage",
          interface_binding_id: "binding_storage",
          interface_resolved_revision: 1,
        },
      }),
    );
    const request = () =>
      new Request(`https://storage.example${path}`, {
        method: path === "/mcp" ? "POST" : "GET",
        headers: {
          authorization: "Bearer taksrv_synthetic_interface_token",
          "content-type": "application/json",
        },
        ...(path === "/mcp"
          ? {
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/list",
              }),
            }
          : {}),
      });
    expect((await worker.fetch(request(), env)).status).toBe(200);
    expect(
      (
        await worker.fetch(request(), {
          ...env,
          APP_WORKSPACE_ID: "legacy-workspace",
        })
      ).status,
    ).toBe(200);
    capsuleId = "other-app";
    expect((await worker.fetch(request(), env)).status).toBe(401);
    expect(
      (await worker.fetch(request(), { ...env, APP_CAPSULE_ID: undefined }))
        .status,
    ).toBe(503);
  });
}
