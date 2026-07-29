terraform {
  required_version = ">= 1.5"

  required_providers {
    takoform = {
      source  = "registry.opentofu.org/tako0614/takoform"
      version = "= 0.2.0"
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

variable "worker_release_tag" {
  description = "Takos Storage release selected by the pinned Worker artifact."
  type        = string
  default     = "v0.3.0"
}

variable "worker_bundle_url" {
  description = "Immutable HTTPS Worker artifact URL pinned by this release."
  type        = string
  default     = "https://github.com/tako0614/takos-storage/releases/download/v0.3.0/worker.js"

  validation {
    condition     = can(regex("^https://[^[:space:]]+$", trimspace(var.worker_bundle_url)))
    error_message = "worker_bundle_url must be an https URL."
  }
}

variable "worker_bundle_sha256" {
  description = "Expected SHA-256 for the pinned Worker artifact."
  type        = string
  default     = "sha256:773864cc63e8ff5a1d238577015e53f451d659fda77124ff9986ea69436b8645"

  validation {
    condition     = can(regex("^(sha256:)?[a-f0-9]{64}$", trimspace(var.worker_bundle_sha256)))
    error_message = "worker_bundle_sha256 must be lowercase SHA-256 hex or sha256:<hex>."
  }
}

locals {
  artifact_url            = trimspace(var.worker_bundle_url)
  artifact_sha256         = trimspace(var.worker_bundle_sha256)
  artifact_sha256_checked = startswith(local.artifact_sha256, "sha256:") ? local.artifact_sha256 : "sha256:${local.artifact_sha256}"
  release_tag             = trimspace(var.worker_release_tag)
  interface_declarations = {
    launcher = {
      name = "takos-storage.launcher"
      document = {
        launcher = true
        display = {
          title = "Takos Storage"
          icon  = "/icons/takos-storage.svg"
        }
        endpoint = { originInput = "origin", path = "/" }
      }
    }
    object = {
      name = "takos-storage.object"
      document = {
        display  = { title = "Takos Storage Object API" }
        endpoint = { originInput = "origin", path = "/o" }
        permissions = [
          "storage.object.read",
          "storage.object.write",
          "storage.object.delete",
          "storage.object.list",
        ]
      }
    }
    mcp = {
      name = "takos-storage.mcp"
      document = {
        transport = "streamable-http"
        display   = { title = "Takos Storage" }
        endpoint  = { originInput = "origin", path = "/mcp" }
      }
    }
  }
}

resource "takoform_object_bucket" "objects" {
  name          = "${var.project_name}-objects"
  storage_class = "standard"
}

resource "takoform_http_service" "worker" {
  name            = var.project_name
  artifact_url    = local.artifact_url
  artifact_sha256 = local.artifact_sha256_checked
  runtime         = "javascript"

  connections = [
    {
      name        = "BUCKET"
      resource    = takoform_object_bucket.objects.id
      permissions = ["delete", "list", "read", "write"]
      projection  = "object.binding.v1"
    },
  ]

  lifecycle {
    precondition {
      condition     = strcontains(local.artifact_url, "/releases/download/${local.release_tag}/")
      error_message = "worker_bundle_url must select the exact worker_release_tag."
    }
  }
}

resource "takoform_interface" "surface" {
  for_each = local.interface_declarations

  name          = each.value.name
  version       = "1"
  resource_kind = "HttpService"
  resource_name = takoform_http_service.worker.name
  document_json = jsonencode(each.value.document)
  inputs_json = jsonencode([
    {
      name    = "origin"
      source  = "output"
      pointer = "/url"
    }
  ])
}
