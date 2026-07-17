import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const [packageSource, moduleSource, outputsSource] = await Promise.all([
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../main.tf", import.meta.url), "utf8"),
  readFile(new URL("../outputs.tf", import.meta.url), "utf8"),
]);

const packageVersion = (JSON.parse(packageSource) as { version: string })
  .version;

describe("release version", () => {
  test("keeps the OpenTofu artifact default aligned", () => {
    const releaseVariable = moduleSource.match(
      /variable\s+"worker_release_tag"\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    expect(releaseVariable).toBeDefined();
    expect(releaseVariable).toContain(`default     = "v${packageVersion}"`);
    expect(outputsSource).not.toContain("app_deployment");
    expect(outputsSource).not.toContain("service_exports");
  });

  test("matches the Git tag when the release workflow runs", () => {
    const gitRef = process.env.GITHUB_REF_NAME;
    if (!gitRef?.startsWith("v")) return;
    expect(gitRef).toBe(`v${packageVersion}`);
  });

  test("keeps runtime declarations and credentials out of ordinary outputs", () => {
    expect(outputsSource).not.toContain('output "service_grant_signing_key"');
    expect(outputsSource).not.toContain('output "published_mcp_auth_token"');
    expect(outputsSource).not.toContain('output "storage_admin_token"');
    expect(outputsSource).not.toContain("sensitive   = true");
    expect(outputsSource).toContain('output "oidc_redirect_uri"');
    expect(moduleSource).not.toContain('resource "random_id"');
    expect(moduleSource).not.toContain("STORAGE_TOKEN_SIGNING_KEY");
    expect(moduleSource).not.toContain("STORAGE_ADMIN_TOKEN");
    expect(moduleSource).not.toContain('variable "service_grant_signing_key"');
    expect(moduleSource).toContain('version = "= 3.9.0"');
  });

  test("uses one canonical origin for Worker bindings and published audiences", () => {
    expect(moduleSource).toContain(
      'public_origin    = trimsuffix(trimspace(var.public_url), "/")',
    );
    expect(moduleSource).toContain(
      'accounts_issuer_url     = trimsuffix(trimspace(var.takosumi_accounts_issuer_url), "/")',
    );
    expect(moduleSource).toContain('name = "APP_URL"');
    expect(moduleSource).toContain(
      'text = local.launch_url != null ? local.launch_url : ""',
    );
    expect(outputsSource).toContain("value       = local.launch_url");
    expect(outputsSource).toContain("value       = local.api_base_url");
    expect(outputsSource).toContain("value       = local.mcp_url");
  });

  test("does not require post-apply Interface evidence as module input", () => {
    expect(moduleSource).not.toContain("takosumi_object_interface_id");
    expect(moduleSource).not.toContain(
      "takosumi_object_interface_resolved_revision",
    );
    expect(moduleSource).not.toContain("takosumi_mcp_interface_id");
    expect(moduleSource).not.toContain(
      "takosumi_mcp_interface_resolved_revision",
    );
    expect(moduleSource).not.toContain("APP_OBJECT_INTERFACE_ID");
    expect(moduleSource).not.toContain(
      "APP_OBJECT_INTERFACE_RESOLVED_REVISION",
    );
    expect(moduleSource).not.toContain("APP_MCP_INTERFACE_ID");
    expect(moduleSource).not.toContain("APP_MCP_INTERFACE_RESOLVED_REVISION");
  });
});
