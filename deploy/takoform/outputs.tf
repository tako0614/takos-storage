locals {
  launch_url = try(takoform_http_service.worker.outputs["url"], null)
}

output "launch_url" {
  description = "Canonical public URL allocated by the selected Takoform host."
  value       = local.launch_url
}

output "api_url" {
  description = "Primary object API resource URI."
  value       = try("${trimsuffix(local.launch_url, "/")}/o", null)
}

output "mcp_url" {
  description = "Published Streamable HTTP MCP resource URI."
  value       = try("${trimsuffix(local.launch_url, "/")}/mcp", null)
}

output "takoform_resource_ids" {
  description = "Canonical portable Resource identities for this instance."
  value = {
    worker = takoform_http_service.worker.id
    bucket = takoform_object_bucket.objects.id
  }
}
