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
});
