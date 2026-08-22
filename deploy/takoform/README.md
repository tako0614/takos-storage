# Takos Storage Takoform Capsule

This is the canonical portable resource definition and the repository
manifest's default module for Takos Storage. The repository root remains the
explicit direct Cloudflare path.

The graph uses current Takoform resources: an `ObjectBucket` and a ModuleWorker
bundle/version/deployment/endpoint with an explicit `BUCKET` binding. The
release tag, immutable GitHub release URL, and SHA-256 are pinned together. A
runner downloads the artifact into its ignored `.terraform` cache, verifies
the digest, and the Takoform provider commits the verified bytes through the
Host artifact API.

Takoform owns only the deployable Resource graph. The repository manifest owns
the `storage.object` and `mcp.server` declarations and maps their resource URIs
from ordinary module Outputs after apply. The Host resolves the public service
origin; consumers discover a Ready Interface and use a short-lived Interface
credential. No Interface, Binding, Workspace, Capsule, or provider authority
is copied into the Resource graph.

The portable default deliberately does not declare the browser launcher. It
requires a browser-session secret and host runtime materialization that cannot
be represented truthfully by this module yet. The direct root module remains
available for an operator that explicitly supplies that configuration.

Takosumi owns Plan review, runtime secrets, Accounts/Interface context, OIDC
delivery, binding credentials, and authorization. The selected Takoform Host
owns Resource placement and the endpoint Output. Object export/purge before
destroy remains a reviewed service-side lifecycle action; a host must not
delete a non-empty bucket silently.
