import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const text = await readFile(new URL(".well-known/takosumi.json", root), "utf8");
const manifest = JSON.parse(text) as RepositoryManifest;
const options = JSON.parse(
  await readFile(new URL("install-options.json", root), "utf8"),
) as { options: Array<{ source: { path: string } }> };
const moduleSources: Record<string, string> = {
  ".": await readFile(new URL("main.tf", root), "utf8"),
  "deploy/takoform": await readFile(
    new URL("deploy/takoform/main.tf", root),
    "utf8",
  ),
};

test("Takos Storage publishes a closed Repository manifest", () => {
  expect(Object.keys(manifest).sort()).toEqual([
    "apiVersion",
    "install",
    "kind",
  ]);
  expect(manifest.apiVersion).toBe("takosumi.com/v2.4");
  expect(manifest.kind).toBe("Repository");
  expect(Object.keys(manifest.install)).toEqual(["modules"]);
  expect(Object.keys(manifest.install.modules)).toEqual([
    ".",
    "deploy/takoform",
  ]);
  for (const option of options.options) {
    expect(manifest.install.modules[option.source.path]).toBeDefined();
  }
});

test("default portable install declares launcher, object and agent MCP Interfaces", () => {
  const interfaces =
    manifest.install.modules["deploy/takoform"]?.interfaces ?? [];
  expect(interfaces.map((entry) => entry.spec.type)).toEqual([
    "interface.ui.surface",
    "storage.object",
    "mcp.server",
  ]);
  const mcp = interfaces.find((entry) => entry.spec.type === "mcp.server");
  expect(mcp?.spec.version).toBe("2025-11-25");
  expect(mcp?.spec.inputs.endpoint?.outputName).toBe("mcp_url");
  expect(mcp?.bindingRequests).toEqual([
    {
      key: "installer",
      subject: { source: "installing_principal" },
      permissions: ["mcp.invoke"],
      delivery: { type: "oauth2" },
    },
  ]);
});

test("each install module declares an installer-authorized launcher backed by launch_url", async () => {
  for (const [path, module] of Object.entries(manifest.install.modules)) {
    const launchers = (module.interfaces ?? []).filter(
      (entry) => entry.spec.type === "interface.ui.surface",
    );
    expect(launchers).toEqual([
      {
        key: "launcher",
        name: "takos-storage.launcher",
        spec: {
          type: "interface.ui.surface",
          version: "1",
          document: {
            launcher: true,
            display: { title: "Takos Storage" },
          },
          inputs: {
            url: {
              source: "output",
              outputName: "launch_url",
              outputType: "url",
            },
          },
          access: { visibility: "workspace" },
        },
        bindingRequests: [
          {
            key: "installer",
            subject: { source: "installing_principal" },
            permissions: ["ui.open"],
            delivery: { type: "none" },
          },
        ],
      },
    ]);
    const outputs = await readFile(new URL(`${path}/outputs.tf`, root), "utf8");
    const launchOutput = outputs.match(
      /output\s+"launch_url"\s*\{([^}]*)\}/u,
    )?.[1];
    expect(launchOutput).toBeDefined();
    expect(launchOutput).toMatch(/\bvalue\s*=/u);
    expect(launchOutput).not.toMatch(/\b(?:sensitive|ephemeral)\s*=\s*true/u);
  }
});

test("declared modules reference real variables and no secret or host authority", () => {
  for (const [path, module] of Object.entries(manifest.install.modules)) {
    const source = moduleSources[path];
    expect(source).toBeDefined();
    const variables = new Set(
      Array.from(
        source.matchAll(/variable\s+"([^"]+)"\s*\{/g),
        (match) => match[1],
      ),
    );
    for (const name of referencedVariables(module)) {
      expect(variables.has(name)).toBe(true);
    }
    for (const input of module.inputs) {
      expect(input.secret).toBeUndefined();
      if (input.source.kind === "module_default") {
        expect(variableBlock(source, input.name)).toMatch(/\n\s+default\s+=/);
      }
    }
  }
  for (const forbidden of [
    "cloudflare_account_id",
    "enable_cloudflare_resources",
    "enable_cloudflare_worker_script",
    "published_mcp_auth_token",
    "takosumi_accounts_client_secret",
    "app_session_secret",
    "takosumi_workspace_id",
    "takosumi_capsule_id",
    '"env"',
    "credential",
  ]) {
    expect(text).not.toContain(forbidden);
  }
});

function variableBlock(source: string, name: string): string {
  const start = source.indexOf(`variable "${name}" {`);
  const next = source.indexOf("\nvariable ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function referencedVariables(module: RepositoryModule): Set<string> {
  const names = new Set(module.inputs.map((input) => input.name));
  for (const requirement of module.requires ?? []) {
    for (const value of Object.values(requirement.deliver.variables ?? {}))
      names.add(value);
  }
  for (const projection of module.installExperience?.projections ?? []) {
    if (projection.variable) names.add(projection.variable);
    for (const value of Object.values(projection.variables ?? {})) {
      names.add(value);
    }
  }
  return names;
}

interface RepositoryManifest {
  apiVersion: string;
  kind: string;
  install: {
    modules: Record<string, RepositoryModule>;
  };
}

interface RepositoryModule {
  requires?: Array<{
    kind: string;
    deliver: {
      variables?: Record<string, string>;
      bindings?: Record<string, string>;
    };
  }>;
  sourceBuild?: { commands: Array<{ argv: string[] }>; outputs: string[] };
  inputs: Array<{
    name: string;
    source: { kind: string };
    secret?: boolean;
  }>;
  installExperience?: {
    projections: Array<{
      variable?: string;
      variables?: Record<string, string>;
    }>;
  };
  interfaces?: Array<{
    key: string;
    name: string;
    spec: {
      type: string;
      version: string;
      document: Record<string, unknown>;
      inputs: Record<
        string,
        { source: string; outputName?: string; outputType?: string }
      >;
      access: { visibility: string; resourceUriInput?: string };
    };
    bindingRequests?: Array<Record<string, unknown>>;
  }>;
}

test("portable browser wiring uses exact sealed bindings and builds the selected source", () => {
  const portable = manifest.install.modules["deploy/takoform"]!;
  expect(portable.requires?.map((entry) => entry.kind)).toEqual([
    "secret.generated",
    "identity.oidc",
  ]);
  expect(portable.requires?.map((entry) => entry.deliver.bindings)).toEqual([
    { value: "APP_SESSION_SECRET" },
    {
      issuerUrl: "OIDC_ISSUER_URL",
      clientId: "OIDC_CLIENT_ID",
      ownerSubject: "OIDC_OWNER_SUB",
      redirectUri: "OIDC_REDIRECT_URI",
    },
  ]);
  expect(portable.sourceBuild).toEqual({
    commands: [
      { argv: ["bun", "install", "--frozen-lockfile"] },
      { argv: ["bun", "run", "build:worker"] },
    ],
    outputs: ["dist/worker.js"],
  });
  expect(portable.inputs.map((entry) => entry.name)).toEqual(["project_name"]);
});
