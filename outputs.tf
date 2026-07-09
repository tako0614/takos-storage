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
# consumed only by the storage credential issuer.
output "storage_token_signing_key" {
  description = "Shared HMAC signing key for scoped storage tokens. Consumed by the storage credential issuer to mint per-consumer tokens."
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

    publish = [
      {
        name      = "launcher"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
        display = {
          title       = "Takos Storage"
          description = "Scoped object storage for workspace apps."
          icon        = "/icons/takos-storage.svg"
          category    = "storage"
        }
        spec = {
          launcher = true
        }
      },
    ]

    env = merge(
      local.extra_worker_env,
      {
        APP_URL = local.launch_url != null ? local.launch_url : ""
      },
    )
  }
}

output "service_exports" {
  description = "Runtime service surface published by takos-storage: the object store consumers bind to."
  value = [
    {
      name         = "storage.object"
      capabilities = ["storage.object", "protocol.http.api"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/o"
          url        = local.api_base_url
        },
      ]
      # NOTE: object KEYS in this projected output must avoid the substrings
      # token/secret/password/credential/auth/bearer/session/cookie/key — the
      # Takosumi output secret-scan drops the whole output otherwise. The grant
      # shape (scopes / injected env var names) is owned by the CONSUMER's
      # `consume` block and the Takosumi issuer, not advertised here.
      metadata = {
        title         = "Object Storage"
        description   = "Shared object store isolated per consumer."
        capabilityIds = ["storage.object.v1"]
      }
      visibility = "space"
    },
    {
      name         = "launcher"
      capabilities = ["interface.ui.surface"]
      endpoints = [
        {
          name       = "default"
          protocol   = "https"
          pathPrefix = "/"
          url        = local.launch_url
        },
      ]
      metadata = {
        title       = "Takos Storage"
        description = "Open the object storage console for this Capsule."
        icon        = "/icons/takos-storage.svg"
        category    = "storage"
      }
      visibility = "space"
    },
  ]
}
