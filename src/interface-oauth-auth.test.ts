import { describe, expect, test } from "bun:test";

import { verifyInterfaceOAuthBearer } from "./interface-oauth-auth.ts";

const TOKEN = "taksrv_storage_test_token";
const PERMISSION = "storage.object.read";
const validClaims = {
  token_use: "interface_oauth",
  sub: "principal_storage",
  aud: "https://storage.example/o",
  scope: PERMISSION,
  takosumi: {
    workspace_id: "workspace_a",
    capsule_id: "capsule_storage",
    interface_id: "interface_storage_object",
    interface_binding_id: "binding_a",
    interface_resolved_revision: 4,
  },
};

function verify(
  body: unknown,
  overrides: {
    token?: string;
    permission?: string;
    requestUrl?: string;
    workspaceId?: string;
    capsuleId?: string;
    interfaceId?: string;
    interfaceResolvedRevision?: number;
    status?: number;
  } = {},
): Promise<boolean> {
  return verifyInterfaceOAuthBearer(
    new Request(
      overrides.requestUrl ?? "https://storage.example/o/documents/a.txt",
    ),
    overrides.token ?? TOKEN,
    overrides.permission ?? PERMISSION,
    {
      issuerUrl: "https://accounts.example/issuer",
      expectedAudience: "https://storage.example/o",
      expectedWorkspaceId: overrides.workspaceId ?? "workspace_a",
      expectedCapsuleId: overrides.capsuleId ?? "capsule_storage",
      expectedInterfaceId: overrides.interfaceId ?? "interface_storage_object",
      expectedInterfaceResolvedRevision:
        overrides.interfaceResolvedRevision ?? 4,
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://accounts.example/oauth/userinfo");
        expect(init?.redirect).toBe("manual");
        return Response.json(body, { status: overrides.status ?? 200 });
      },
    },
  );
}

describe("Interface OAuth verifier", () => {
  test("accepts exact audience, permission, owner, Binding, and revision", async () => {
    expect(await verify(validClaims)).toBe(true);
  });

  test("rejects mismatched or incomplete evidence", async () => {
    expect(
      await verify({ ...validClaims, aud: "https://storage.example/mcp" }),
    ).toBe(false);
    expect(
      await verify({ ...validClaims, scope: "storage.object.write" }),
    ).toBe(false);
    expect(
      await verify({
        ...validClaims,
        scope: "storage.object.read storage.object.write",
      }),
    ).toBe(false);
    expect(
      await verify({
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_binding_id: undefined,
        },
      }),
    ).toBe(false);
    expect(
      await verify({
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_resolved_revision: 0,
        },
      }),
    ).toBe(false);
  });

  test("rejects a stale InterfaceBinding observation of the Interface revision", async () => {
    expect(await verify(validClaims, { interfaceResolvedRevision: 5 })).toBe(
      false,
    );
  });

  test("rejects non-Interface tokens, unrelated resources, and non-200 UserInfo", async () => {
    expect(await verify(validClaims, { token: "takat_delegated" })).toBe(false);
    expect(
      await verify(validClaims, {
        requestUrl: "https://storage.example/mcp",
      }),
    ).toBe(false);
    expect(await verify(validClaims, { status: 302 })).toBe(false);
  });
});
