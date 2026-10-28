import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const direct = await readFile(new URL("../main.tf", import.meta.url), "utf8");

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
