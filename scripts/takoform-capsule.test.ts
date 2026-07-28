import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const moduleUrl = new URL("../deploy/takoform/", import.meta.url);
const [main, outputs] = await Promise.all([
  readFile(new URL("main.tf", moduleUrl), "utf8"),
  readFile(new URL("outputs.tf", moduleUrl), "utf8"),
]);

describe("Takos Storage Takoform Capsule", () => {
  test("owns the portable Worker and ObjectBucket graph", () => {
    expect(main).toContain('resource "takoform_edge_worker" "worker"');
    expect(main).toContain('resource "takoform_object_bucket" "objects"');
    expect(main).toContain('name        = "BUCKET"');
    expect(main).toContain("resource    = takoform_object_bucket.objects.id");
    expect(main).toContain('permissions = ["delete", "list", "read", "write"]');
  });

  test("uses Takoform directly and no Cloudflare compatibility desired state", () => {
    expect(main).toContain(
      'source  = "registry.opentofu.org/tako0614/takoform"',
    );
    expect(main).not.toContain("cloudflare/cloudflare");
    expect(main).not.toContain('resource "cloudflare_');
    expect(main).not.toContain("/compat/cloudflare/");
  });

  test("publishes ordinary public outputs only", () => {
    expect(outputs).toContain('output "launch_url"');
    expect(outputs).toContain('output "api_url"');
    expect(outputs).toContain('output "mcp_url"');
    expect(outputs).not.toContain("app_deployment");
    expect(outputs).not.toContain("service_exports");
  });
});
