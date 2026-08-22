locals {
  launch_url = takoform_worker_endpoint.worker.url
}

output "launch_url" {
  description = "Canonical public URL allocated by the selected Takoform host."
  value       = local.launch_url
}

output "api_url" {
  description = "Primary object API resource URI."
  value       = "${trimsuffix(local.launch_url, "/")}/o"
}

output "mcp_url" {
  description = "Published Streamable HTTP MCP resource URI."
  value       = "${trimsuffix(local.launch_url, "/")}/mcp"
}

output "takoform_resource_ids" {
  description = "Canonical portable Resource identities for this instance."
  value = {
    worker     = takoform_module_worker.worker.uid
    bundle     = takoform_worker_bundle.worker.uid
    version    = takoform_worker_version.worker.uid
    deployment = takoform_worker_deployment.worker.uid
    endpoint   = takoform_worker_endpoint.worker.uid
    bucket     = takoform_edge_object_bucket.objects.uid
  }
}
