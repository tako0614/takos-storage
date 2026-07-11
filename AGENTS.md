# AGENTS.md — takos-storage

Standalone installable Capsule providing the `storage.object` object
store. Sibling product to yurucommu / takos-office; **not** part of the Takos
worker and **not** the closed `takosumi-cloud` S3-compat extension.

## Boundaries

- OSS installable Capsule listed by the Takosumi Store as discovery metadata
  only. Plain OpenTofu module + prebuilt Worker; no Takosumi-specific manifest.
- Access is via **bind-time scoped tokens** minted by Takosumi, verified here
  with the shared `STORAGE_TOKEN_SIGNING_KEY`. Token format is owned by
  `src/token.ts` (`tksvc_` prefix, HMAC-SHA256); the Takosumi minting side
  MUST match this format byte-for-byte.
- Substrate (the R2 bucket) is provisioned by this module's own `main.tf`, not
  by the takos deploy module.
- S3 SigV4 compatibility is deferred (P0.5); keep the surface a plain HTTP
  object API for now.

## Tasks

- `bun test` — unit tests (`bun:test`).
- `bun run check` — `bunx tsc --noEmit` (source only; tests run under bun).
- `bun run build:worker` — emit local `dist/worker.js` for self-host applies;
  hosted installs should use `worker_bundle_url` + `worker_bundle_sha256` from a
  Git release or CI artifact. Do not commit built output.
- `tofu fmt` / `tofu validate` — module hygiene.

## Conventions

- Dependency-free Worker (Web Crypto only) so it runs on workerd and typechecks
  without `@cloudflare/workers-types` (minimal R2 types live in `src/types.ts`).
- `outputs.tf` publishes generic service outputs (`launch_url`, `url`,
  `public_url`, `api_url`, `app_deployment`, `service_exports`) and
  `service_exports[0].name = "storage.object"` with `storage.object` /
  `protocol.http.api`; the grant descriptor injects object-storage connection
  material into consumers. Do not expose Takos-specific output names.
