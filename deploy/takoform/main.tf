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
