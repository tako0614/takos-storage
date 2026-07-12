output "launch_url" {
  description = "Public URL for the published object-storage service, when the Capsule has enough hostname input to derive it."
  value       = local.launch_url
}

output "url" {
  description = "Alias for launch_url for generic Takosumi public URL smoke checks."
  value       = local.launch_url
}

output "public_url" {
  description = "Canonical public URL for the published object-storage service."
  value       = local.launch_url
}

output "api_url" {
  description = "Primary service API URL for the /o object API surface."
  value       = local.api_base_url
}

output "mcp_url" {
  description = "Published Streamable HTTP MCP endpoint."
  value       = local.mcp_url
}

output "service_runtime_name" {
  description = "Implementation runtime name used when enable_cloudflare_worker_script is true."
  value       = local.runtime_name
}

output "service_runtime_managed_by_opentofu" {
  description = "True when the HTTP runtime and bindings are managed by OpenTofu."
  value       = local.cloudflare_worker_enabled
}

output "service_runtime_resource_id" {
  description = "Provider-native runtime resource ID, or null when enable_cloudflare_worker_script is false."
  value       = try(cloudflare_workers_script.worker[0].id, null)
}

output "object_bucket_name" {
  description = "Backing object bucket name for the BUCKET binding."
  value       = local.r2_objects_bucket
}

# Sensitive: the shared HMAC key Takosumi reads to mint scoped service grants.
# Stripped from public projection (never leaves the encrypted output artifact);
# consumed only by the service grant issuer.
output "service_grant_signing_key" {
  description = "Shared HMAC signing key for scoped service grants. Consumed by the grant issuer to mint per-consumer access material for the service_exports capability."
  value       = local.effective_signing_key
  sensitive   = true
}

output "published_mcp_auth_token" {
  description = "Bearer credential for direct clients of the published /mcp endpoint."
  value       = local.effective_mcp_token
  sensitive   = true
}

output "app_deployment" {
  description = "Installable app declaration consumed from tofu output -json by Capsule projection flows."
  value = {
    contractVersion = 1
    name            = "takos-storage"
    version         = "0.2.3"

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
      published_mcp_auth_token = {
        type     = "secret"
        bind     = "PUBLISHED_MCP_AUTH_TOKEN"
        to       = ["web"]
        generate = true
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
      {
        id      = "mcp"
        target  = "web"
        path    = "/mcp"
        methods = ["POST"]
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
      {
        name      = "takos-storage-mcp"
        publisher = "web"
        type      = "protocol.mcp.server"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "mcp"
          }
        }
        auth = {
          bearer = {
            secretRef = "PUBLISHED_MCP_AUTH_TOKEN"
          }
        }
        display = {
          title       = "Takos Storage MCP"
          description = "Workspace drive file tools over Streamable HTTP."
        }
        spec = {
          protocol = "streamable-http"
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
  description = "Runtime surfaces published by this Capsule: object-store consumers bind through storage.object and agents discover the drive MCP through protocol.mcp.server."
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
        description = "Open the workspace drive for this Capsule."
        icon        = "/icons/takos-storage.svg"
        category    = "storage"
      }
      visibility = "space"
    },
    {
      name         = "takos-storage-mcp"
      capabilities = ["protocol.mcp.server"]
      endpoints = [
        {
          name       = "streamable-http"
          protocol   = "https"
          pathPrefix = "/mcp"
          url        = local.mcp_url
        },
      ]
      auth = [
        {
          scheme = "bearer"
          scopes = ["mcp.invoke"]
        },
      ]
      metadata = {
        title       = "Takos Storage MCP"
        description = "Workspace drive file tools over Streamable HTTP."
        protocol    = "streamable-http"
      }
      visibility = "space"
    },
  ]
}

output "oidc_redirect_uri" {
  description = "OAuth redirect URI to register on the Takosumi Accounts OIDC client when drive sign-in is enabled."
  value       = local.oidc_redirect_uri
}
