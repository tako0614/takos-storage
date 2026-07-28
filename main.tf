terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.19.1"
    }
    http = {
      source  = "hashicorp/http"
      version = "= 3.6.0"
    }
    # Upgrade bridge only: v0.2.x state contains random_id credentials. There
    # are no random resources in v0.3.0, but the pinned provider lets OpenTofu
    # destroy those retired state objects during the first upgrade apply.
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.0"
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
  description = "Canonical HTTPS origin for the storage service (an optional trailing slash is removed). When empty, launch_url is derived from public_subdomain and cloudflare_workers_subdomain."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.public_url) == "" || can(regex("^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\\[[0-9A-Fa-f:]+\\])(:[0-9]{1,5})?/?$", trimspace(var.public_url)))
    error_message = "public_url must be empty or a bare HTTPS origin with no userinfo, path, query, or fragment."
  }
}

variable "published_mcp_auth_token" {
  description = "Optional standalone bearer protecting /mcp for direct/self-host clients. Managed calls use Interface OAuth; no credential is generated or output when this is empty."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.published_mcp_auth_token) == "" || length(trimspace(var.published_mcp_auth_token)) >= 32
    error_message = "published_mcp_auth_token must be empty or at least 32 characters."
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
        "ALLOW_UNAUTHENTICATED_DRIVE",
        "APP_WORKSPACE_ID",
        "APP_CAPSULE_ID",
      ], name)
    ])
    error_message = "env keys must be uppercase Worker plain-text variable names and must not be secret-like or reserved by the takos-storage module."
  }
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional bare HTTPS Takosumi Accounts issuer origin (an optional trailing slash is removed). Interface OAuth validates runtime calls against its UserInfo endpoint; together with a client id it also enables drive sign-in."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_issuer_url) == "" || can(regex("^https://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\\[[0-9A-Fa-f:]+\\])(:[0-9]{1,5})?/?$", trimspace(var.takosumi_accounts_issuer_url)))
    error_message = "takosumi_accounts_issuer_url must be empty or a bare HTTPS origin with no userinfo, path, query, or fragment."
  }
}

variable "allow_unauthenticated_drive" {
  description = "Serve the drive UI and /api/drive with no sign-in at all. Off by default: the drive is authenticated unless an operator deliberately publishes it to the whole internet, including anonymous upload and delete."
  type        = bool
  default     = false
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
  description = "HMAC secret sealing drive UI session cookies. Required when drive sign-in is enabled; it is never generated or returned by this module."
  type        = string
  default     = ""
  sensitive   = true

  validation {
    condition     = trimspace(var.app_session_secret) == "" || length(trimspace(var.app_session_secret)) >= 16
    error_message = "app_session_secret must be empty or at least 16 characters."
  }
}

variable "takosumi_workspace_id" {
  description = "Owning Takosumi Workspace id used to verify Interface OAuth evidence and optional drive membership."
  type        = string
  default     = ""
}

variable "takosumi_capsule_id" {
  description = "Owning Takosumi Capsule id used to verify Interface OAuth evidence."
  type        = string
  default     = ""
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
  description = "Explicit local path to a reviewed, source-built Worker module JS file. Exactly one of worker_bundle_path or worker_bundle_url is required when deploying the Worker."
  type        = string
  default     = ""
}

variable "worker_release_tag" {
  description = "Optional GitHub release tag used to cross-check an explicitly selected worker_bundle_url. No release artifact is selected implicitly."
  type        = string
  default     = ""

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
  description = "Expected SHA-256 of the explicitly selected Worker module JS. Accepts lowercase hex or sha256:<hex> and is required for both URL and local artifacts."
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
  worker_bundle_url             = trimspace(var.worker_bundle_url)
  worker_bundle_path            = trimspace(var.worker_bundle_path)
  worker_bundle_uses_url        = local.cloudflare_worker_enabled && local.worker_bundle_url != ""
  worker_bundle_uses_local      = local.cloudflare_worker_enabled && local.worker_bundle_path != ""
  worker_bundle_sha256_input    = trimspace(var.worker_bundle_sha256)
  worker_bundle_expected_sha256 = startswith(local.worker_bundle_sha256_input, "sha256:") ? replace(local.worker_bundle_sha256_input, "sha256:", "") : local.worker_bundle_sha256_input
  worker_bundle_local_path      = local.worker_bundle_path == "" ? null : (startswith(local.worker_bundle_path, "/") ? local.worker_bundle_path : "${path.module}/${local.worker_bundle_path}")
  worker_bundle_body            = local.worker_bundle_uses_url ? data.http.worker_bundle[0].response_body : null
  worker_bundle_content_sha256  = local.worker_bundle_uses_url ? sha256(data.http.worker_bundle[0].response_body) : (local.worker_bundle_uses_local ? filesha256(local.worker_bundle_local_path) : null)

  resource_prefix  = var.project_name
  public_subdomain = trimspace(var.public_subdomain) != "" ? trimspace(var.public_subdomain) : local.resource_prefix
  runtime_name     = local.public_subdomain
  workers_dev_url  = trimspace(var.cloudflare_workers_subdomain) != "" ? "https://${local.public_subdomain}.${trimspace(var.cloudflare_workers_subdomain)}.workers.dev" : null
  public_origin    = trimsuffix(trimspace(var.public_url), "/")
  launch_url       = local.public_origin != "" ? local.public_origin : local.workers_dev_url
  api_base_url     = local.launch_url != null ? "${local.launch_url}/o" : null
  mcp_url          = local.launch_url != null ? "${local.launch_url}/mcp" : null

  provided_mcp_token = trimspace(var.published_mcp_auth_token)
  extra_worker_env   = { for name, value in var.env : name => value if trimspace(value) != "" }

  accounts_issuer_url     = trimsuffix(trimspace(var.takosumi_accounts_issuer_url), "/")
  app_auth_enabled        = local.accounts_issuer_url != "" && trimspace(var.takosumi_accounts_client_id) != ""
  provided_session_secret = trimspace(var.app_session_secret)
  workspace_id            = trimspace(var.takosumi_workspace_id)
  capsule_id              = trimspace(var.takosumi_capsule_id)
  interface_owner_enabled = local.workspace_id != "" && local.capsule_id != ""
  oidc_redirect_uri       = local.launch_url != null ? "${local.launch_url}/api/auth/callback/takos" : null

  r2_objects_bucket = "${local.resource_prefix}-objects"
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
  content_file        = local.worker_bundle_uses_local ? local.worker_bundle_local_path : null
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
    local.provided_mcp_token != "" ? [
      {
        type = "secret_text"
        name = "PUBLISHED_MCP_AUTH_TOKEN"
        text = local.provided_mcp_token
      },
    ] : [],
    local.accounts_issuer_url != "" ? [
      {
        type = "plain_text"
        name = "OIDC_ISSUER_URL"
        text = local.accounts_issuer_url
      },
    ] : [],
    local.interface_owner_enabled ? [
      {
        type = "plain_text"
        name = "APP_WORKSPACE_ID"
        text = local.workspace_id
      },
      {
        type = "plain_text"
        name = "APP_CAPSULE_ID"
        text = local.capsule_id
      },
    ] : [],
    var.allow_unauthenticated_drive ? [
      {
        type = "plain_text"
        name = "ALLOW_UNAUTHENTICATED_DRIVE"
        text = "1"
      },
    ] : [],
    local.app_auth_enabled ? [
      {
        type = "plain_text"
        name = "OIDC_CLIENT_ID"
        text = trimspace(var.takosumi_accounts_client_id)
      },
      {
        type = "secret_text"
        name = "APP_SESSION_SECRET"
        text = local.provided_session_secret
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
      condition = !local.cloudflare_worker_enabled || (
        local.launch_url != null &&
        local.accounts_issuer_url != "" &&
        local.interface_owner_enabled
      )
      error_message = "A deployed Worker requires a public URL, Accounts issuer, and owning Workspace/Capsule. Current Interface evidence is revalidated by Accounts UserInfo at invocation time."
    }

    precondition {
      condition     = (local.workspace_id == "") == (local.capsule_id == "")
      error_message = "takosumi_workspace_id and takosumi_capsule_id must be set together."
    }

    precondition {
      condition     = !local.app_auth_enabled || local.provided_session_secret != ""
      error_message = "app_session_secret is required when Takosumi Accounts drive sign-in is enabled."
    }

    # The drive is authenticated by default, so an install that cannot sign
    # anyone in must be rejected here rather than serve anonymous list /
    # download / upload / delete.
    precondition {
      condition = !local.cloudflare_worker_enabled || var.allow_unauthenticated_drive || (
        local.app_auth_enabled && local.provided_session_secret != ""
      )
      error_message = "Drive sign-in requires takosumi_accounts_issuer_url, takosumi_accounts_client_id, and app_session_secret. Set allow_unauthenticated_drive = true only to publish an anonymous read/write drive on purpose."
    }

    precondition {
      condition     = !local.cloudflare_worker_enabled || (local.worker_bundle_uses_url != local.worker_bundle_uses_local)
      error_message = "Exactly one explicit Worker artifact is required: set worker_bundle_url or worker_bundle_path, but not both."
    }

    precondition {
      condition     = !local.cloudflare_worker_enabled || (local.worker_bundle_expected_sha256 != "" && local.worker_bundle_expected_sha256 == local.worker_bundle_content_sha256)
      error_message = "worker_bundle_sha256 is required and must match the explicitly selected Worker artifact."
    }

    precondition {
      condition     = local.worker_release_tag == "" || (local.worker_bundle_uses_url && strcontains(local.worker_bundle_url, "/releases/download/${local.worker_release_tag}/"))
      error_message = "worker_bundle_url must select the exact worker_release_tag when worker_release_tag is set."
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
