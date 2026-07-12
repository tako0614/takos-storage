terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.19.1"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

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
  description = "Shared HMAC signing key for scoped service grants (64-char lowercase hex). When empty, a key is generated. Takosumi mints grants with the same value it reads from the service_grant_signing_key output."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.service_grant_signing_key) == "" || can(regex("^[a-f0-9]{64}$", trimspace(var.service_grant_signing_key)))
    error_message = "service_grant_signing_key must be empty or a 64-character lowercase hex key."
  }
}

variable "published_mcp_auth_token" {
  description = "Optional bearer token protecting the published /mcp endpoint. A 32-byte token is generated when empty."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.published_mcp_auth_token) == "" || length(trimspace(var.published_mcp_auth_token)) >= 32
    error_message = "published_mcp_auth_token must be empty or at least 32 characters."
  }
}

variable "storage_admin_token" {
  description = "Optional bearer token for destructive storage administration such as POST /api/admin/empty. A 32-byte token is generated when empty."
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
        "STORAGE_TOKEN_SIGNING_KEY",
        "PUBLISHED_MCP_AUTH_TOKEN",
        "STORAGE_ADMIN_TOKEN",
        "OIDC_ISSUER_URL",
        "OIDC_CLIENT_ID",
        "APP_AUTH_REQUIRED",
      ], name)
    ])
    error_message = "env keys must be uppercase Worker plain-text variable names and must not be secret-like or reserved by the takos-storage module."
  }
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional Takosumi Accounts OIDC issuer URL. When set together with takosumi_accounts_client_id, the workspace drive UI requires sign-in."
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

locals {
  cloudflare_resources_enabled  = var.enable_cloudflare_resources
  cloudflare_worker_enabled     = local.cloudflare_resources_enabled && var.enable_cloudflare_worker_script
  cloudflare_route_enabled      = local.cloudflare_worker_enabled && trimspace(var.cloudflare_route_zone_id) != "" && trimspace(var.cloudflare_route_pattern) != ""
  worker_release_tag            = trimspace(var.worker_release_tag)
  worker_bundle_explicit_url    = trimspace(var.worker_bundle_url)
  worker_bundle_uses_manifest   = local.cloudflare_worker_enabled && local.worker_bundle_explicit_url == "" && local.worker_release_tag != ""
  worker_release_manifest       = local.worker_bundle_uses_manifest ? jsondecode(data.http.worker_release_manifest[0].response_body) : null
  worker_bundle_url             = local.worker_bundle_explicit_url != "" ? local.worker_bundle_explicit_url : try(local.worker_release_manifest.artifact.url, "")
  worker_bundle_uses_url        = local.cloudflare_worker_enabled && local.worker_bundle_url != ""
  worker_bundle_sha256_input    = trimspace(var.worker_bundle_sha256) != "" ? trimspace(var.worker_bundle_sha256) : (local.worker_bundle_uses_manifest ? try(local.worker_release_manifest.artifact.sha256, "") : "")
  worker_bundle_expected_sha256 = startswith(local.worker_bundle_sha256_input, "sha256:") ? replace(local.worker_bundle_sha256_input, "sha256:", "") : local.worker_bundle_sha256_input
  worker_bundle_local_path      = startswith(var.worker_bundle_path, "/") ? var.worker_bundle_path : "${path.module}/${var.worker_bundle_path}"
  worker_bundle_body            = local.worker_bundle_uses_url ? data.http.worker_bundle[0].response_body : null
  worker_bundle_content_sha256  = local.cloudflare_worker_enabled ? (local.worker_bundle_uses_url ? sha256(data.http.worker_bundle[0].response_body) : (local.worker_bundle_uses_manifest ? null : filesha256(local.worker_bundle_local_path))) : null

  resource_prefix  = var.project_name
  public_subdomain = trimspace(var.public_subdomain) != "" ? trimspace(var.public_subdomain) : local.resource_prefix
  runtime_name     = local.public_subdomain
  workers_dev_url  = trimspace(var.cloudflare_workers_subdomain) != "" ? "https://${local.public_subdomain}.${trimspace(var.cloudflare_workers_subdomain)}.workers.dev" : null
  launch_url       = trimspace(var.public_url) != "" ? trimspace(var.public_url) : local.workers_dev_url
  api_base_url     = local.launch_url != null ? "${local.launch_url}/o" : null
  mcp_url          = local.launch_url != null ? "${local.launch_url}/mcp" : null

  provided_signing_key  = trimspace(var.service_grant_signing_key)
  effective_signing_key = local.provided_signing_key != "" ? local.provided_signing_key : random_id.signing_key.hex
  provided_mcp_token    = trimspace(var.published_mcp_auth_token)
  effective_mcp_token   = local.provided_mcp_token != "" ? local.provided_mcp_token : random_id.published_mcp_auth_token.hex
  provided_admin_token  = trimspace(var.storage_admin_token)
  effective_admin_token = local.provided_admin_token != "" ? local.provided_admin_token : random_id.admin_token.hex
  extra_worker_env      = { for name, value in var.env : name => value if trimspace(value) != "" }

  app_auth_enabled         = trimspace(var.takosumi_accounts_issuer_url) != "" && trimspace(var.takosumi_accounts_client_id) != ""
  provided_session_secret  = trimspace(var.app_session_secret)
  effective_session_secret = local.provided_session_secret != "" ? local.provided_session_secret : random_id.session_secret.hex
  oidc_redirect_uri        = local.launch_url != null ? "${local.launch_url}/api/auth/callback/takos" : null

  r2_objects_bucket = "${local.resource_prefix}-objects"
}

data "http" "worker_release_manifest" {
  count              = local.worker_bundle_uses_manifest ? 1 : 0
  url                = "https://github.com/tako0614/takos-storage/releases/download/${local.worker_release_tag}/takosumi-artifact.json"
  request_timeout_ms = 30000

  request_headers = {
    Accept = "application/json"
  }

  retry {
    attempts     = 3
    min_delay_ms = 500
    max_delay_ms = 5000
  }
}

resource "random_id" "signing_key" {
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

resource "random_id" "session_secret" {
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

resource "random_id" "published_mcp_auth_token" {
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

resource "random_id" "admin_token" {
  byte_length = 32

  keepers = {
    project_name = local.resource_prefix
  }
}

data "http" "worker_bundle" {
  count              = local.worker_bundle_uses_url ? 1 : 0
  url                = local.worker_bundle_url
  request_timeout_ms = 120000

  request_headers = {
    Accept = "application/javascript, text/javascript, application/octet-stream"
  }

  retry {
    attempts     = 3
    min_delay_ms = 1000
    max_delay_ms = 10000
  }
}

resource "cloudflare_r2_bucket" "objects" {
  count      = local.cloudflare_resources_enabled ? 1 : 0
  account_id = var.cloudflare_account_id
  name       = local.r2_objects_bucket
}

resource "cloudflare_workers_script" "worker" {
  count               = local.cloudflare_worker_enabled ? 1 : 0
  account_id          = var.cloudflare_account_id
  script_name         = local.runtime_name
  content             = local.worker_bundle_uses_url ? sensitive(local.worker_bundle_body) : null
  content_file        = local.worker_bundle_uses_url ? null : local.worker_bundle_local_path
  content_sha256      = local.worker_bundle_content_sha256
  main_module         = var.worker_main_module
  compatibility_date  = var.worker_compatibility_date
  compatibility_flags = var.worker_compatibility_flags

  bindings = concat(
    [
      {
        type        = "r2_bucket"
        name        = "BUCKET"
        bucket_name = cloudflare_r2_bucket.objects[0].name
      },
      {
        type = "plain_text"
        name = "APP_URL"
        text = local.launch_url != null ? local.launch_url : ""
      },
    ],
    [
      {
        type = "secret_text"
        name = "STORAGE_TOKEN_SIGNING_KEY"
        text = local.effective_signing_key
      },
      {
        type = "secret_text"
        name = "PUBLISHED_MCP_AUTH_TOKEN"
        text = local.effective_mcp_token
      },
      {
        type = "secret_text"
        name = "STORAGE_ADMIN_TOKEN"
        text = local.effective_admin_token
      },
    ],
    local.app_auth_enabled ? [
      {
        type = "plain_text"
        name = "OIDC_ISSUER_URL"
        text = trimspace(var.takosumi_accounts_issuer_url)
      },
      {
        type = "plain_text"
        name = "OIDC_CLIENT_ID"
        text = trimspace(var.takosumi_accounts_client_id)
      },
      {
        type = "plain_text"
        name = "APP_AUTH_REQUIRED"
        text = "1"
      },
      {
        type = "secret_text"
        name = "APP_SESSION_SECRET"
        text = local.effective_session_secret
      },
    ] : [],
    local.app_auth_enabled && trimspace(var.takosumi_accounts_client_secret) != "" ? [
      {
        type = "secret_text"
        name = "OIDC_CLIENT_SECRET"
        text = trimspace(var.takosumi_accounts_client_secret)
      },
    ] : [],
    [
      for name, value in local.extra_worker_env : {
        type = "plain_text"
        name = name
        text = value
      }
    ],
  )

  lifecycle {
    precondition {
      condition = !local.worker_bundle_uses_manifest || (
        try(local.worker_release_manifest.kind, "") == "takosumi.worker-artifact@v1" &&
        try(local.worker_release_manifest.app, "") == "takos-storage" &&
        try(local.worker_release_manifest.releaseTag, "") == local.worker_release_tag &&
        local.worker_bundle_uses_url
      )
      error_message = "worker_release_tag must resolve to a valid takos-storage takosumi.worker-artifact@v1 manifest."
    }

    precondition {
      condition     = !local.worker_bundle_uses_url || (local.worker_bundle_expected_sha256 != "" && local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256)
      error_message = "worker_bundle_sha256 is required for worker_bundle_url and must match the downloaded artifact."
    }

    precondition {
      condition     = local.worker_bundle_uses_url || local.worker_bundle_uses_manifest || local.worker_bundle_expected_sha256 == "" || local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256
      error_message = "worker_bundle_sha256 does not match worker_bundle_path."
    }

  }
}

resource "cloudflare_workers_script_subdomain" "worker" {
  count            = local.cloudflare_worker_enabled && var.enable_workers_dev_subdomain ? 1 : 0
  account_id       = var.cloudflare_account_id
  script_name      = cloudflare_workers_script.worker[0].script_name
  enabled          = true
  previews_enabled = false
}

resource "cloudflare_workers_route" "worker" {
  count   = local.cloudflare_route_enabled ? 1 : 0
  zone_id = trimspace(var.cloudflare_route_zone_id)
  pattern = trimspace(var.cloudflare_route_pattern)
  script  = cloudflare_workers_script.worker[0].script_name
}
