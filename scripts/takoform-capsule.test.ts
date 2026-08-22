import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const moduleUrl = new URL("../deploy/takoform/", import.meta.url);
const [main, outputs] = await Promise.all([
  readFile(new URL("main.tf", moduleUrl), "utf8"),
  readFile(new URL("outputs.tf", moduleUrl), "utf8"),
]);

describe("Takos Storage Takoform Capsule", () => {
  test("owns the current portable Worker and ObjectBucket graph", () => {
    expect(main).toContain('resource "takoform_module_worker" "worker"');
    expect(main).toContain('resource "takoform_worker_bundle" "worker"');
    expect(main).toContain('resource "takoform_worker_version" "worker"');
    expect(main).toContain('resource "takoform_worker_deployment" "worker"');
    expect(main).toContain('resource "takoform_worker_endpoint" "worker"');
    expect(main).toContain('resource "takoform_edge_object_bucket" "objects"');
    expect(main).not.toContain('resource "takoform_interface"');
    expect(main).toContain('name        = "BUCKET"');
    expect(main).toContain(
      "target_name = takoform_edge_object_bucket.objects.name",
    );
    expect(main).toContain(
      'source  = "registry.terraform.io/tako0614/takoform"',
    );
    expect(main).toContain('version = "= 2.1.1"');
    expect(main).not.toContain("registry.opentofu.org/hashicorp/external");
    expect(main).not.toContain('data "external"');
    expect(main).toContain(
      "manifest_digest = trimspace(var.worker_bundle_manifest_digest)",
    );
    expect(main).toContain(
      'default     = "sha256:49ea8a92634723d76bd18315f68fcaf0e3f57e104c49fd0c39476d697cbd2396"',
    );
  });

  test("uses Takoform directly and no Cloudflare compatibility desired state", () => {
    expect(main).toContain(
      'source  = "registry.terraform.io/tako0614/takoform"',
    );
    expect(main).not.toContain("cloudflare/cloudflare");
    expect(main).not.toContain('resource "cloudflare_');
    expect(main).not.toContain("/compat/cloudflare/");
    expect(main).not.toContain("compatibility_date");
    expect(main).not.toContain("compatibility_flags");
  });

  test("publishes ordinary public outputs only", () => {
    expect(outputs).toContain('output "launch_url"');
    expect(outputs).toContain('output "api_url"');
    expect(outputs).toContain('output "mcp_url"');
    expect(outputs).not.toContain("app_deployment");
    expect(outputs).not.toContain("service_exports");
  });
});
