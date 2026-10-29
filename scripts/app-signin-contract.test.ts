import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const direct = await readFile(new URL("../main.tf", import.meta.url), "utf8");
const portable = await readFile(
  new URL("../deploy/takoform/main.tf", import.meta.url),
  "utf8",
);

test("direct install context binds the app id beside its compatibility Workspace id", () => {
  expect(direct).toMatch(
    /workspace_id\s*=\s*trimspace\(var\.takosumi_workspace_id\)/u,
  );
  expect(direct).toMatch(
    /capsule_id\s*=\s*trimspace\(var\.takosumi_capsule_id\)/u,
  );
  for (const [name, value] of [
    ["APP_WORKSPACE_ID", "workspace_id"],
    ["APP_CAPSULE_ID", "capsule_id"],
  ]) {
    expect(direct).toContain(`name = "${name}"\n        text = local.${value}`);
    // Caller-provided env must not override the installed app identity.
    const envValidation = direct.slice(
      direct.indexOf('variable "env"'),
      direct.indexOf("# Public OIDC grant metadata"),
    );
    expect(envValidation).toContain(`"${name}",`);
  }
});

test("portable install context explicitly binds app identity without copying OIDC secrets", () => {
  for (const [input, binding, local] of [
    ["takosumi_workspace_id", "APP_WORKSPACE_ID", "workspace_id"],
    ["takosumi_capsule_id", "APP_CAPSULE_ID", "capsule_id"],
  ]) {
    expect(portable).toContain(`variable "${input}"`);
    expect(portable).toContain(`trimspace(var.${input})`);
    expect(portable).toContain(`{ ${binding} = local.${local} }`);
  }
  expect(portable).toContain(
    "vars_json      = jsonencode(local.app_identity_vars)",
  );
  const plainIdentity = portable.slice(
    portable.indexOf("  app_identity_vars = merge("),
    portable.indexOf('resource "takoform_edge_object_bucket"'),
  );
  expect(plainIdentity).not.toContain("OIDC_");
  expect(plainIdentity).not.toContain("APP_SESSION_SECRET");
  expect(portable).not.toContain("must be set together");
  expect(direct).toContain('interface_owner_enabled = local.capsule_id != ""');
  expect(direct).toContain('local.workspace_id != "" ? [');
  expect(direct).not.toContain("must be set together");
});

test("portable install validates supplied identities and accepts a legacy Workspace context", () => {
  expect(portable).toContain(
    'condition     = local.capsule_id != "" || local.workspace_id != ""',
  );
  expect(portable).toContain(
    "takosumi_workspace_id must be empty or a bounded id without whitespace.",
  );
  expect(portable).toContain(
    "takosumi_capsule_id must be empty or a bounded id without whitespace.",
  );
});
