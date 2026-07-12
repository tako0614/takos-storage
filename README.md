# takos-storage

A standalone, installable **object-store service**. Other apps
(takos-office, yurucommu, …) bind to it instead of each rolling their own blob
storage. It is a plain OpenTofu module + prebuilt Cloudflare Worker, installed
through Takosumi like any other Capsule and surfaced in the Capsule launcher.

## What it is

- A Worker exposing a small HTTP object API over its own R2 bucket.
- Every request is gated by a **scoped bearer token** that Takosumi mints at
  bind time. A token is bounded to a key prefix (`pfx`) and a verb set
  (read / write / delete / list), so a consumer app can only touch its slice.
- Deterministic Capsule removal: by default the OpenTofu module calls a
  module-owned, bearer-protected lifecycle endpoint before deleting the Worker
  and R2 bucket. Set `purge_objects_on_destroy = false` to make deletion of a
  non-empty bucket fail closed instead. The executor needs `curl` for this
  destroy-time step.
- The service publishes the `storage.object` service export; consumers declare
  a matching `consume` block and receive scoped object-storage connection
  material injected into their env.
- The Worker also serves a small browser console at `/` and `/ui`, so an
  installed storage Capsule is not just a headless API. Its drive routes use
  the optional user OIDC session and never accept app-owned object grants.
- Agents use the bearer-protected Streamable HTTP MCP endpoint at `/mcp`.
  Its six `storage_file_*` tools are confined to the user-facing `drive/`
  area and cannot access app-owned objects exposed through `/o`.

This is **not** the closed `takosumi-cloud` S3-compat platform extension. It is
an OSS installable Capsule in the same lane as yurucommu / takos-office. S3
SigV4 compatibility is intentionally out of scope for P0.

## HTTP surface

| Method | Path            | Verb | Notes                    |
| ------ | --------------- | ---- | ------------------------ |
| GET    | `/healthz`      | —    | liveness, no auth        |
| GET    | `/`, `/ui`      | —    | browser console, no auth |
| POST   | `/mcp`          | —    | Streamable HTTP MCP      |
| PUT    | `/o/<key>`      | `w`  | store object             |
| GET    | `/o/<key>`      | `r`  | fetch object             |
| HEAD   | `/o/<key>`      | `r`  | object metadata          |
| DELETE | `/o/<key>`      | `d`  | remove object            |
| GET    | `/o?prefix=<p>` | `l`  | list keys under a prefix |

Keys and list prefixes must fall within the token's `pfx`; otherwise `403`.

## MCP surface

`/mcp` publishes exactly these tools:

- `storage_file_list`
- `storage_file_read`
- `storage_file_write`
- `storage_file_info`
- `storage_file_delete`
- `storage_file_move`

Paths are always relative to the fixed `drive/` bucket prefix. Read and write
support UTF-8 text or base64, and decoded files are limited to 50 MiB. Listings
accept an opaque R2 continuation cursor. The endpoint fails closed when
`PUBLISHED_MCP_AUTH_TOKEN` is absent; OpenTofu generates the token by default,
injects it as a Worker secret, and publishes the endpoint as
`protocol.mcp.server` with the `mcp.invoke` scope.

## Develop

```sh
bun test              # unit tests (token + worker)
bun run check         # typecheck (tsc --noEmit)
bun run build:worker  # emit local dist/worker.js for self-host applies
```

## Deploy (OpenTofu)

The repo root is a self-contained OpenTofu module. Resources are inert until the
feature flags are on:

```sh
tofu init
tofu apply \
  -var enable_cloudflare_resources=true \
  -var enable_cloudflare_worker_script=true \
  -var cloudflare_account_id=<id> \
  -var public_subdomain=<service-subdomain> \
  -var cloudflare_workers_subdomain=<workers-dev-subdomain>
```

For local/self-host applies, `dist/worker.js` must exist before apply. Hosted
installs should point `worker_bundle_url` + `worker_bundle_sha256` at a Git
release or CI artifact instead of committing built output to the repository.

### Grant signing key

`service_grant_signing_key` is the shared HMAC key. Leave it empty to generate
one; it is emitted as the **sensitive** `service_grant_signing_key` output, which
the Takosumi grant issuer reads to mint per-consumer access material for the
`storage.object` service export. The same value is injected into the Worker as
`STORAGE_TOKEN_SIGNING_KEY`.

### MCP bearer

`published_mcp_auth_token` optionally supplies the bearer used by `/mcp`.
Leave it empty to generate a 32-byte value. Direct OpenTofu consumers can read
the sensitive `published_mcp_auth_token` output; Capsule projection uses the
generated `PUBLISHED_MCP_AUTH_TOKEN` resource referenced by the MCP
publication.
