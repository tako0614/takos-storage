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
    expect(main).toContain('version = "= 4.1.0"');
    expect(main).not.toContain("registry.opentofu.org/hashicorp/external");
    expect(main).not.toContain('data "external"');
    expect(main).toContain(
      'content_file = "${path.module}/../../dist/worker.js"',
    );
    expect(main).not.toContain("manifest_digest");
    expect(main).toContain(
      "vars_json      = jsonencode(local.app_identity_vars)",
    );
    for (const name of [
      "APP_SESSION_SECRET",
      "OIDC_ISSUER_URL",
      "OIDC_CLIENT_ID",
      "OIDC_OWNER_SUB",
      "OIDC_REDIRECT_URI",
    ])
      expect(main).toContain(`"${name}"`);
    expect(main).not.toContain("takoform_worker_endpoint.worker.url");
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
