output "launch_url" {
  description = "Public URL for the object-storage service, when enough hostname input is available."
  value       = local.launch_url
}

output "api_url" {
  description = "Primary /o object API resource URI. Takosumi may map this ordinary output into an Interface document service-side."
  value       = local.api_base_url
}

output "mcp_url" {
  description = "Published Streamable HTTP MCP resource URI."
  value       = local.mcp_url
}

output "service_runtime_name" {
  description = "Provider-native runtime name used when the Worker script is enabled."
  value       = local.runtime_name
}

output "service_runtime_managed_by_opentofu" {
  description = "True when this OpenTofu module manages the HTTP runtime and bindings."
  value       = local.cloudflare_worker_enabled
}

output "service_runtime_resource_id" {
  description = "Provider-native runtime resource id, or null when the Worker script is disabled."
  value       = try(cloudflare_workers_script.worker[0].id, null)
}

output "object_bucket_name" {
  description = "Backing object bucket name. This is an ordinary operational output, not a runtime registry or credential."
  value       = local.r2_objects_bucket
}

output "cloudflare_account_id" {
  description = "Cloudflare account id used by reviewed operator lifecycle actions. This is an ordinary non-secret infrastructure output."
  value       = var.cloudflare_account_id
}

output "oidc_redirect_uri" {
  description = "OAuth redirect URI to register service-side when drive sign-in is enabled."
  value       = local.oidc_redirect_uri
}
