# AGENTS.md — takos-storage

Standalone installable Capsule providing an object-store HTTP API, browser drive, and storage MCP. It is a sibling product, not a Takos internal service and not Takosumi Cloud's closed storage implementation.

## Boundaries

- The repository root is a plain OpenTofu module plus a prebuilt Worker artifact. Do not add a Takosumi manifest, reserved Output schema, or Takosumi provider wrapper.
- Takosumi owns Interface / InterfaceBinding declarations service-side. This module returns ordinary infrastructure and endpoint Outputs only.
- Managed runtime calls use invocation-only `taksrv_` Interface OAuth credentials. Validate exact audience, one exact permission, Workspace, Capsule, Interface, InterfaceBinding, and resolved revision through Accounts UserInfo.
- Public origin, expected Interface ids, and current resolved revisions come only from service-side module inputs; never derive them from caller-controlled request metadata.
- Each object InterfaceBinding has a private `interface-bindings/<encoded-binding-id>/` physical namespace.
- Never reintroduce app-local `tksvc_` HMAC grants, shared signing keys, credential Outputs, or a standing destructive admin endpoint.
- Direct/self-host MCP may use an explicitly configured `PUBLISHED_MCP_AUTH_TOKEN`; it is never generated or output. Managed MCP uses `mcp.invoke` Interface OAuth.
- R2 migration and pre-destroy cleanup are explicit operator lifecycle actions using provider credentials outside the Worker.

## Checks

- `bun test`
- `bun run check`
- `bun run build:worker`
- `tofu fmt -check -recursive`
- `tofu init -backend=false -lockfile=readonly && tofu validate`

Do not commit `dist/`, local `.terraform/`, provider credentials, environment files, certificates, or secret values.
