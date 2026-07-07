# AGENTS.md — takos-storage

Standalone installable Capsule providing the `takos.storage.object` object
store. Sibling product to yurucommu / takos-office; **not** part of the takos
worker and **not** the closed `takosumi-cloud` S3-compat extension.

## Boundaries

- OSS installable Capsule (CURATED_GIT_CATALOG / yurucommu lane). Plain
  OpenTofu module + prebuilt Worker; no Takosumi-specific manifest.
- Access is via **bind-time scoped tokens** minted by Takosumi, verified here
  with the shared `STORAGE_TOKEN_SIGNING_KEY`. Token format is owned by
  `src/token.ts` (`takstor_` prefix, HMAC-SHA256); the Takosumi minting side
  MUST match this format byte-for-byte.
- Substrate (the R2 bucket) is provisioned by this module's own `main.tf`, not
  by the takos deploy module.
- S3 SigV4 compatibility is deferred (P0.5); keep the surface a plain HTTP
  object API for now.

## Tasks

- `bun test` — unit tests (`bun:test`).
- `bun run check` — `bunx tsc --noEmit` (source only; tests run under bun).
- `bun run build:worker` — emit `dist/worker.js`.
- `tofu fmt` / `tofu validate` — module hygiene.

## Conventions

- Dependency-free Worker (Web Crypto only) so it runs on workerd and typechecks
  without `@cloudflare/workers-types` (minimal R2 types live in `src/types.ts`).
- `outputs.tf` publishes `service_exports[0].name = "takos.storage.object"`
  with `storage.object` / `protocol.http.api`; the grant descriptor injects
  `TAKOS_STORAGE_API_URL` + `TAKOS_STORAGE_ACCESS_TOKEN` into consumers.
