terraform {
  required_version = ">= 1.8.0"

  required_providers {
    takoform = {
      source  = "registry.terraform.io/tako0614/takoform"
      version = "= 4.1.0"
    }
  }
}

variable "project_name" {
  description = "Portable resource-name prefix for this Takos Storage instance."
  type        = string
  default     = "takos-storage"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

# Service-owned installContextVariableMapping supplies these non-secret ids.
# Repository metadata and incoming sign-in claims never choose the expected id.
variable "takosumi_workspace_id" {
  description = "Optional compatibility Workspace id from authenticated install context."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_workspace_id) == "" || can(regex("^[^[:space:]]{1,512}$", trimspace(var.takosumi_workspace_id)))
    error_message = "takosumi_workspace_id must be empty or a bounded id without whitespace."
  }
}

variable "takosumi_capsule_id" {
  description = "Optional installed app id from authenticated install context; required for app-scoped browser claims."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_capsule_id) == "" || can(regex("^[^[:space:]]{1,512}$", trimspace(var.takosumi_capsule_id)))
    error_message = "takosumi_capsule_id must be empty or a bounded id without whitespace."
  }
}

locals {
  workspace_id = trimspace(var.takosumi_workspace_id)
  capsule_id   = trimspace(var.takosumi_capsule_id)
  app_identity_vars = merge(
    local.workspace_id != "" ? { APP_WORKSPACE_ID = local.workspace_id } : {},
    local.capsule_id != "" ? { APP_CAPSULE_ID = local.capsule_id } : {},
  )
}

resource "takoform_edge_object_bucket" "objects" {
  name = "${var.project_name}-objects"
}

resource "takoform_module_worker" "worker" {
  name = var.project_name
}

resource "takoform_worker_bundle" "worker" {
  revision_owner = var.project_name
  main_module    = "worker.js"
  modules = [{
    name         = "worker.js"
    content_type = "application/javascript+module"
    content_file = "${path.module}/../../dist/worker.js"
  }]

  lifecycle {
    create_before_destroy = true
  }
}

resource "takoform_worker_version" "worker" {
  revision_owner = var.project_name
  worker         = takoform_module_worker.worker.name
  bundle         = takoform_worker_bundle.worker.name
  handlers       = ["fetch"]
  vars_json      = jsonencode(local.app_identity_vars)
  required_sensitive_vars = [
    "APP_SESSION_SECRET",
    "OIDC_ISSUER_URL",
    "OIDC_CLIENT_ID",
    "OIDC_OWNER_SUB",
    "OIDC_REDIRECT_URI",
  ]

  bucket_bindings = [
    {
      name        = "BUCKET"
      target_name = takoform_edge_object_bucket.objects.name
    },
  ]

  lifecycle {
    create_before_destroy = true

    precondition {
      condition     = local.capsule_id != "" || local.workspace_id != ""
      error_message = "Authenticated install context must supply takosumi_capsule_id or legacy takosumi_workspace_id."
    }
  }
}

resource "takoform_worker_deployment" "worker" {
  name   = "${var.project_name}-deployment"
  worker = takoform_module_worker.worker.name
  versions = [
    {
      worker_version = takoform_worker_version.worker.name
      weight         = 10000
    },
  ]
}

resource "takoform_worker_endpoint" "worker" {
  name   = "${var.project_name}-endpoint"
  worker = takoform_module_worker.worker.name

  depends_on = [takoform_worker_deployment.worker]
}
