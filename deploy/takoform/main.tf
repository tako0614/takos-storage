terraform {
  required_version = ">= 1.8.0"

  required_providers {
    takoform = {
      source  = "registry.terraform.io/tako0614/takoform"
      version = "= 2.1.1"
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

variable "worker_bundle_manifest_digest" {
  description = "Content-addressed WorkerBundle manifest committed to the selected Takoform Host for Takos Storage v0.3.0."
  type        = string
  default     = "sha256:49ea8a92634723d76bd18315f68fcaf0e3f57e104c49fd0c39476d697cbd2396"

  validation {
    condition     = can(regex("^sha256:[a-f0-9]{64}$", trimspace(var.worker_bundle_manifest_digest)))
    error_message = "worker_bundle_manifest_digest must be a canonical sha256:<hex> manifest digest."
  }
}

variable "takosumi_accounts_issuer_url" {
  description = "Takosumi Accounts issuer used to validate short-lived Interface OAuth credentials."
  type        = string
  default     = ""
}

variable "takosumi_accounts_client_id" {
  description = "Public PKCE client id allocated to this installed Capsule."
  type        = string
  default     = ""
}

locals {
  runtime_vars = merge(
    trimspace(var.takosumi_accounts_issuer_url) == "" ? {} : {
      OIDC_ISSUER_URL = trimspace(var.takosumi_accounts_issuer_url)
    },
    trimspace(var.takosumi_accounts_client_id) == "" ? {} : {
      OIDC_CLIENT_ID = trimspace(var.takosumi_accounts_client_id)
    },
  )
}

resource "takoform_edge_object_bucket" "objects" {
  name = "${var.project_name}-objects"
}

resource "takoform_module_worker" "worker" {
  name = var.project_name
}

resource "takoform_worker_bundle" "worker" {
  revision_owner  = var.project_name
  manifest_digest = trimspace(var.worker_bundle_manifest_digest)

  lifecycle {
    create_before_destroy = true
  }
}

resource "takoform_worker_version" "worker" {
  revision_owner = var.project_name
  worker         = takoform_module_worker.worker.name
  bundle         = takoform_worker_bundle.worker.name
  handlers       = ["fetch"]
  vars_json      = jsonencode(local.runtime_vars)

  bucket_bindings = [
    {
      name        = "BUCKET"
      target_name = takoform_edge_object_bucket.objects.name
    },
  ]

  lifecycle {
    create_before_destroy = true
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
