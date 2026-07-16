# Takosumi-managed entry root for takos-storage.
#
# The repository root stays a plain OpenTofu module with no Takosumi
# dependency, so direct self-hosters keep running `tofu init && tofu apply`
# against it unchanged. This wrapper is the managed install path
# (modulePath = deploy/takosumi): it composes the plain module as a child and
# additionally declares this Capsule's runtime Interfaces in-run through the
# optional takosumi provider (the runner injects TAKOSUMI_ENDPOINT /
# TAKOSUMI_TOKEN / TAKOSUMI_WORKSPACE_ID / TAKOSUMI_CAPSULE_ID, so the
# provider block needs no static configuration).
#
# Interface names match the reference InstallConfig blueprints; when this
# root is active the blueprints contribute only their InterfaceBinding
# proposals (install-time authorization defaults) while the spec below is
# authoritative. Consumer authorization always stays service-side.

terraform {
  required_version = ">= 1.5"

  required_providers {
    takosumi = {
      source  = "takosjp/takosumi"
      version = ">= 1.0.0"
    }
  }
}

provider "takosumi" {}

variable "enable_cloudflare_resources" {
  description = "Provision the takos-storage Cloudflare backing resources (R2 bucket) with the cloudflare/cloudflare provider."
  type        = bool
  default     = false
}

variable "cloudflare_account_id" {
  description = "Cloudflare account id used when enable_cloudflare_resources is true."
  type        = string
  default     = ""

  validation {
    condition     = !var.enable_cloudflare_resources || trimspace(var.cloudflare_account_id) != ""
    error_message = "cloudflare_account_id is required when enable_cloudflare_resources is true."
  }
}

variable "project_name" {
  description = "Prefix for takos-storage backing resource names."
  type        = string
  default     = "takos-storage"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "public_subdomain" {
  description = "Public subdomain label used for the hosted service. Defaults to project_name."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.public_subdomain) == "" || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", var.public_subdomain))
    error_message = "public_subdomain must be empty or a 1-63 character lowercase DNS label."
  }
}

variable "public_url" {
  description = "Canonical public URL for the storage service. When empty, launch_url is derived from public_subdomain and cloudflare_workers_subdomain."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.public_url) == "" || can(regex("^https://[^[:space:]]+$", var.public_url))
    error_message = "public_url must be empty or an https URL."
  }
}

variable "service_grant_signing_key" {
  description = "Shared HMAC signing key for scoped service grants (64-char lowercase hex). When empty, the plain module generates a key."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.service_grant_signing_key) == "" || can(regex("^[a-f0-9]{64}$", trimspace(var.service_grant_signing_key)))
    error_message = "service_grant_signing_key must be empty or a 64-character lowercase hex key."
  }
}

variable "published_mcp_auth_token" {
  description = "Optional standalone bearer protecting /mcp for direct/self-host clients. When empty, only Interface OAuth is accepted and no static bearer is provisioned."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.published_mcp_auth_token) == "" || length(trimspace(var.published_mcp_auth_token)) >= 32
    error_message = "published_mcp_auth_token must be empty or at least 32 characters."
  }
}

variable "storage_admin_token" {
  description = "Optional bearer token for destructive storage administration such as POST /api/admin/empty. The plain module generates one when empty."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.storage_admin_token) == "" || length(trimspace(var.storage_admin_token)) >= 32
    error_message = "storage_admin_token must be empty or at least 32 characters."
  }
}

variable "env" {
  description = "Additional non-secret Worker environment variables projected as plain_text bindings. Secrets must use dedicated sensitive variables or Provider Connections."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for name, value in var.env :
      can(regex("^[A-Z_][A-Z0-9_]{0,127}$", name)) &&
      !can(regex("(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_?KEY|API_?KEY)", upper(name))) &&
      !contains([
        "BUCKET",
        "APP_URL",
        "PUBLISHED_MCP_AUTH_TOKEN",
        "OIDC_ISSUER_URL",
        "OIDC_CLIENT_ID",
        "APP_AUTH_REQUIRED",
      ], name)
    ])
    error_message = "env keys must be uppercase Worker plain-text variable names and must not be secret-like or reserved by the takos-storage module."
  }
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional Takosumi Accounts OIDC issuer URL. Interface OAuth uses it for runtime calls; together with takosumi_accounts_client_id it also enables drive sign-in."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_issuer_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_issuer_url)))
    error_message = "takosumi_accounts_issuer_url must be empty or an https URL."
  }
}

variable "takosumi_accounts_client_id" {
  description = "Optional Takosumi Accounts OIDC client id used with takosumi_accounts_issuer_url (public client; PKCE)."
  type        = string
  default     = ""
}

variable "takosumi_accounts_client_secret" {
  description = "Optional OIDC client secret for confidential clients. Leave empty for PKCE public clients."
  type        = string
  default     = ""
  sensitive   = true
}

variable "app_session_secret" {
  description = "HMAC secret sealing drive UI session cookies. Generated when empty and sign-in is enabled."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.app_session_secret) == "" || length(trimspace(var.app_session_secret)) >= 16
    error_message = "app_session_secret must be empty or at least 16 characters."
  }
}

variable "cloudflare_workers_subdomain" {
  description = "Cloudflare workers.dev subdomain used to derive launch_url for Worker-dev deployments."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_workers_subdomain) == "" || can(regex("^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$", var.cloudflare_workers_subdomain))
    error_message = "cloudflare_workers_subdomain must be empty or a valid workers.dev subdomain label."
  }
}

variable "enable_cloudflare_worker_script" {
  description = "Deploy the takos-storage Worker script, bindings, route, and optional workers.dev enablement through OpenTofu."
  type        = bool
  default     = false
}

variable "worker_bundle_path" {
  description = "Local path to a source-built Worker module JS file. Used only when worker_release_tag and worker_bundle_url are both empty."
  type        = string
  default     = "dist/worker.js"
}

variable "worker_release_tag" {
  description = "GitHub release tag whose takosumi-artifact.json selects the default Worker bundle and SHA-256. Set empty to use worker_bundle_path."
  type        = string
  default     = "v0.2.4"

  validation {
    condition     = trimspace(var.worker_release_tag) == "" || can(regex("^v[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$", trimspace(var.worker_release_tag)))
    error_message = "worker_release_tag must be empty or a SemVer-like Git tag beginning with v."
  }
}

variable "worker_bundle_url" {
  description = "Optional HTTPS URL for a prebuilt Worker module JS artifact. When set, OpenTofu downloads it and verifies worker_bundle_sha256 before upload."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.worker_bundle_url)))
    error_message = "worker_bundle_url must be empty or an https URL."
  }
}

variable "worker_bundle_sha256" {
  description = "Expected SHA-256 of the Worker module JS. Accepts lowercase hex or sha256:<hex>. Required when worker_bundle_url is set."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.worker_bundle_sha256) == "" || can(regex("^(sha256:)?[a-f0-9]{64}$", trimspace(var.worker_bundle_sha256)))
    error_message = "worker_bundle_sha256 must be empty, a lowercase 64-character hex SHA-256 digest, or sha256:<hex>."
  }
}

variable "worker_main_module" {
  description = "Module name used as the Cloudflare Worker main module when uploading worker_bundle_path."
  type        = string
  default     = "worker.js"
}

variable "enable_workers_dev_subdomain" {
  description = "Enable the Worker on the account's workers.dev subdomain when enable_cloudflare_worker_script is true."
  type        = bool
  default     = true
}

variable "cloudflare_route_zone_id" {
  description = "Optional Cloudflare zone id used to create a Worker route. For Takosumi Cloud compat this is the virtual zone id."
  type        = string
  default     = ""
}

variable "cloudflare_route_pattern" {
  description = "Optional Worker route pattern, for example storage.app.takos.jp/*."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.cloudflare_route_pattern) == "" || can(regex("^[^[:space:]]+/\\*$", trimspace(var.cloudflare_route_pattern)))
    error_message = "cloudflare_route_pattern must be empty or a Worker route pattern ending in /*."
  }
}

variable "worker_compatibility_date" {
  description = "Cloudflare Workers compatibility date for the OpenTofu-managed Worker script."
  type        = string
  default     = "2026-04-01"
}

variable "worker_compatibility_flags" {
  description = "Cloudflare Workers compatibility flags for the OpenTofu-managed Worker script."
  type        = set(string)
  default     = ["global_fetch_strictly_public"]
}
module "takos_storage" {
  source = "../.."

  enable_cloudflare_resources     = var.enable_cloudflare_resources
  cloudflare_account_id           = var.cloudflare_account_id
  project_name                    = var.project_name
  public_subdomain                = var.public_subdomain
  public_url                      = var.public_url
  service_grant_signing_key       = var.service_grant_signing_key
  published_mcp_auth_token        = var.published_mcp_auth_token
  storage_admin_token             = var.storage_admin_token
  env                             = var.env
  takosumi_accounts_issuer_url    = var.takosumi_accounts_issuer_url
  takosumi_accounts_client_id     = var.takosumi_accounts_client_id
  takosumi_accounts_client_secret = var.takosumi_accounts_client_secret
  app_session_secret              = var.app_session_secret
  cloudflare_workers_subdomain    = var.cloudflare_workers_subdomain
  enable_cloudflare_worker_script = var.enable_cloudflare_worker_script
  worker_bundle_path              = var.worker_bundle_path
  worker_release_tag              = var.worker_release_tag
  worker_bundle_url               = var.worker_bundle_url
  worker_bundle_sha256            = var.worker_bundle_sha256
  worker_main_module              = var.worker_main_module
  enable_workers_dev_subdomain    = var.enable_workers_dev_subdomain
  cloudflare_route_zone_id        = var.cloudflare_route_zone_id
  cloudflare_route_pattern        = var.cloudflare_route_pattern
  worker_compatibility_date       = var.worker_compatibility_date
  worker_compatibility_flags      = var.worker_compatibility_flags
}

resource "takosumi_interface" "launcher" {
  name    = "takos-storage.launcher"
  type    = "interface.ui.surface"
  version = "1"

  document_json = jsonencode({
    launcher = true
    display = {
      title = "Takos Storage"
      icon  = "/icons/takos-storage.svg"
    }
  })

  inputs = {
    url = {
      source      = "capsule_output"
      output_name = "launch_url"
    }
  }

  visibility = "workspace"

  depends_on = [module.takos_storage]
}

resource "takosumi_interface" "mcp" {
  name    = "takos-storage.mcp"
  type    = "mcp.server"
  version = "2025-11-25"

  document_json = jsonencode({
    transport = "streamable-http"
    display = {
      title = "Takos Storage"
    }
  })

  inputs = {
    endpoint = {
      source      = "capsule_output"
      output_name = "mcp_url"
    }
  }

  visibility         = "workspace"
  resource_uri_input = "endpoint"

  depends_on = [module.takos_storage]
}
