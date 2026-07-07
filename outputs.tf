output "launch_url" {
  description = "Public URL for the published takos-storage service, when the Capsule has enough hostname input to derive it."
  value       = local.launch_url
}

output "url" {
  description = "Alias for launch_url for generic Takosumi public URL smoke checks."
  value       = local.launch_url
}

output "storage_api_base_url" {
  description = "Base URL of the workspace object API (the /o surface)."
  value       = local.api_base_url
}

output "worker_name" {
  description = "Cloudflare Worker name used when enable_cloudflare_worker_script is true."
  value       = local.worker_name
}

output "worker_managed_by_opentofu" {
  description = "True when the Worker script and bindings are managed by OpenTofu."
  value       = local.cloudflare_worker_enabled
}

output "cloudflare_worker_script_id" {
  description = "OpenTofu-managed Cloudflare Worker script ID, or null when enable_cloudflare_worker_script is false."
  value       = try(cloudflare_workers_script.worker[0].id, null)
}

output "cloudflare_r2_bucket_name" {
  description = "R2 bucket name backing the BUCKET binding."
  value       = local.r2_objects_bucket
}

# Sensitive: the shared HMAC key Takosumi reads to mint scoped access tokens.
# Stripped from public projection (never leaves the encrypted output artifact);
# consumed only by the Takosumi storage credential issuer.
output "takos_storage_signing_key" {
  description = "Shared HMAC signing key for scoped storage tokens. Consumed by the Takosumi storage credential issuer to mint per-consumer tokens."
  value       = local.effective_signing_key
  sensitive   = true
}

output "app_deployment" {
  description = "Installable app declaration consumed from tofu output -json by Takos/Takosumi install flows."
  value = {
    contractVersion = 1
    name            = "takos-storage"
    version         = "0.1.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/healthz"
      }
    }

    resources = {
      objects = {
        type = "object-store"
        bind = "BUCKET"
        to   = ["web"]
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
    ]

    env = {
      APP_URL = local.launch_url != null ? local.launch_url : ""
    }
  }
}

output "service_exports" {
  description = "Runtime service surface published by takos-storage: the workspace object store consumers bind to."
  value = [
    {
      name         = "takos.storage.workspace"
      capabilities = ["storage.object", "protocol.http.api"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/o"
          url        = local.api_base_url
        },
      ]
      metadata = {
        title         = "Takos Workspace Storage"
        description   = "Scoped-token object store for workspace apps. Each consumer receives a bind-time token bounded to its own key prefix and verb set."
        capabilityIds = ["takos.storage.workspace.v1"]
        grant = {
          scopes = ["files:read", "files:write"]
          inject = {
            env = {
              url   = "TAKOS_STORAGE_API_URL"
              token = "TAKOS_STORAGE_ACCESS_TOKEN"
            }
          }
        }
      }
      visibility = "space"
    },
  ]
}
