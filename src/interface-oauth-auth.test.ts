import { describe, expect, test } from "bun:test";

import {
  hasValidInterfaceOAuthConfiguration,
  verifyInterfaceOAuthBearer,
} from "./interface-oauth-auth.ts";

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
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://accounts.example/oauth/userinfo");
        expect(init?.redirect).toBe("manual");
        return Response.json(body, { status: overrides.status ?? 200 });
      },
    },
  );
}

describe("Interface OAuth verifier", () => {
  test("accepts active UserInfo authority with complete Interface evidence", async () => {
    expect(await verify(validClaims)).toBe(true);
  });

  test("accepts complete live evidence with exact Capsule and no Workspace configuration", async () => {
    expect(
      await verifyInterfaceOAuthBearer(
        new Request("https://storage.example/o/documents/a.txt"),
        TOKEN,
        PERMISSION,
        {
          issuerUrl: "https://accounts.example",
          expectedAudience: "https://storage.example/o",
          expectedCapsuleId: "capsule_storage",
          fetchImpl: async () => Response.json(validClaims),
        },
      ),
    ).toBe(true);
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
    expect(await verify({ ...validClaims, sub: " principal_storage" })).toBe(
      false,
    );
    expect(
      await verify({
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_id: undefined,
        },
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

  test("does not pre-pin current Interface evidence in target configuration", async () => {
    expect(
      await verify({
        ...validClaims,
        takosumi: {
          ...validClaims.takosumi,
          interface_id: "interface_storage_reconciled",
          interface_binding_id: "binding_reconciled",
          interface_resolved_revision: 5,
        },
      }),
    ).toBe(true);
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

describe("workspace-less Interface OAuth", () => {
  const workspaceLess = {
    ...validClaims,
    takosumi: { ...validClaims.takosumi, workspace_id: undefined },
  };
  const config = {
    issuerUrl: "https://accounts.example",
    expectedAudience: "https://storage.example/o",
    expectedCapsuleId: "capsule_storage",
  };
  const request = new Request("https://storage.example/o/document.txt");

  test("configuration needs exact app identity and accepts no Workspace", () => {
    expect(
      hasValidInterfaceOAuthConfiguration({
        issuerUrl: config.issuerUrl,
        audience: config.expectedAudience,
        capsuleId: config.expectedCapsuleId,
      }),
    ).toBe(true);
    expect(
      hasValidInterfaceOAuthConfiguration({
        issuerUrl: config.issuerUrl,
        audience: config.expectedAudience,
        workspaceId: "workspace_a",
      }),
    ).toBe(false);
  });

  test("accepts absent legacy Workspace evidence only with an exact configured Capsule", async () => {
    const verifyWith = (body: unknown, overrides = {}) =>
      verifyInterfaceOAuthBearer(request, TOKEN, PERMISSION, {
        ...config,
        ...overrides,
        fetchImpl: async () => Response.json(body),
      });
    expect(await verifyWith(workspaceLess)).toBe(true);
    expect(
      await verifyWith(workspaceLess, { expectedCapsuleId: undefined }),
    ).toBe(false);
    expect(
      await verifyWith(workspaceLess, { expectedWorkspaceId: "workspace_a" }),
    ).toBe(true);
    expect(
      await verifyWith(validClaims, { expectedWorkspaceId: "other-workspace" }),
    ).toBe(false);
    expect(
      await verifyWith(workspaceLess, { expectedCapsuleId: "other-capsule" }),
    ).toBe(false);
    for (const workspaceId of ["", null, 1]) {
      expect(
        await verifyWith({
          ...workspaceLess,
          takosumi: { ...workspaceLess.takosumi, workspace_id: workspaceId },
        }),
      ).toBe(false);
    }
  });
});
