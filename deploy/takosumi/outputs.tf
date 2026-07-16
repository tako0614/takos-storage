output "launch_url" {
  description = "Public URL for the published object-storage service, when the Capsule has enough hostname input to derive it."
  value       = module.takos_storage.launch_url
}

output "api_url" {
  description = "Primary service API URL for the /o object API surface."
  value       = module.takos_storage.api_url
}

output "mcp_url" {
  description = "Published Streamable HTTP MCP endpoint."
  value       = module.takos_storage.mcp_url
}

output "service_runtime_name" {
  description = "Implementation runtime name used when enable_cloudflare_worker_script is true."
  value       = module.takos_storage.service_runtime_name
}

output "service_runtime_managed_by_opentofu" {
  description = "True when the HTTP runtime and bindings are managed by OpenTofu."
  value       = module.takos_storage.service_runtime_managed_by_opentofu
}

output "service_runtime_resource_id" {
  description = "Provider-native runtime resource ID, or null when enable_cloudflare_worker_script is false."
  value       = module.takos_storage.service_runtime_resource_id
}

output "object_bucket_name" {
  description = "Backing object bucket name for the BUCKET binding."
  value       = module.takos_storage.object_bucket_name
}

output "oidc_redirect_uri" {
  description = "OAuth redirect URI to register on the Takosumi Accounts OIDC client when drive sign-in is enabled."
  value       = module.takos_storage.oidc_redirect_uri
}
