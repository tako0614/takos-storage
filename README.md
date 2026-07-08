# takos-storage

A standalone, installable **Takos workspace object-store service**. Other apps
(takos-office, yurucommu, …) bind to it instead of each rolling their own blob
storage. It is a plain OpenTofu module + prebuilt Cloudflare Worker, installed
through Takosumi like any other Capsule and surfaced in the Capsule launcher.

## What it is

- A Worker exposing a small HTTP object API over its own R2 bucket.
- Every request is gated by a **scoped bearer token** that Takosumi mints at
  bind time. A token is bounded to a key prefix (`pfx`) and a verb set
  (read / write / delete / list), so a consumer app can only touch its slice.
- The service publishes the `takos.storage.object` service export; consumers
  declare a matching `consume` block and receive `TAKOS_STORAGE_API_URL` +
  `TAKOS_STORAGE_ACCESS_TOKEN` injected into their env.
- The Worker also serves a small browser console at `/` and `/ui`, so an
  installed storage Capsule is not just a headless API. The console is still
  scoped-token based; long-lived object credentials are not stored in the UI.

This is **not** the closed `takosumi-cloud` S3-compat platform extension. It is
an OSS installable Capsule in the same lane as yurucommu / takos-office. S3
SigV4 compatibility is intentionally out of scope for P0.

## HTTP surface

| Method | Path              | Verb | Notes                        |
| ------ | ----------------- | ---- | ---------------------------- |
| GET    | `/healthz`        | —    | liveness, no auth            |
| GET    | `/`, `/ui`        | —    | browser console, no auth     |
| PUT    | `/o/<key>`        | `w`  | store object                 |
| GET    | `/o/<key>`        | `r`  | fetch object                 |
| HEAD   | `/o/<key>`        | `r`  | object metadata              |
| DELETE | `/o/<key>`        | `d`  | remove object                |
| GET    | `/o?prefix=<p>`   | `l`  | list keys under a prefix     |

Keys and list prefixes must fall within the token's `pfx`; otherwise `403`.

## Develop

```sh
bun test              # unit tests (token + worker)
bun run check         # typecheck (tsc --noEmit)
bun run build:worker  # emit dist/worker.js (the artifact main.tf uploads)
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
  -var cloudflare_workers_subdomain=<subdomain>
```

`dist/worker.js` must exist before apply (build it, or point `worker_bundle_url`
+ `worker_bundle_sha256` at a released artifact).

### Signing key

`storage_token_signing_key` is the shared HMAC key. Leave it empty to generate
one; it is emitted as the **sensitive** `takos_storage_signing_key` output, which
the Takosumi storage credential issuer reads to mint per-consumer tokens. The
same value is injected into the Worker as `STORAGE_TOKEN_SIGNING_KEY`.
