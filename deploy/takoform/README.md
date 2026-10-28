# Takos Storage Takoform Capsule

Select `deploy/takoform` explicitly for the portable Host, or `.` for direct
Cloudflare. The v2.5 repository manifest has no implicit default module.

The portable graph retains its ObjectBucket and Worker bundle/version/deployment/
endpoint with the explicit `BUCKET` binding. The installer builds `dist/worker.js`
from the selected immutable source using the declared sourceBuild commands, and
Provider 4.1.0 commits those bytes. It does not use the older release manifest,
which cannot include this source's browser-session consumer.

The manifest declares an installer-authorized browser launcher, Object API and
MCP Interfaces. Only an authorized Ready UI surface makes the app launchable;
`launch_url` alone does not grant access.

Browser sessions use the existing v2.4 runtime-input protocol. Takosumi generates
one Capsule-stable session secret and delivers it privately with the registered
OIDC issuer, public client, pairwise installing subject, and exact callback URI.
Those five bindings are declared as required sensitive names on WorkerVersion;
sensitive values never enter module variables, vars_json or Outputs. The registered HTTPS
callback supplies the browser origin before Apply; no Request Host, guessed
hostname, or post-Apply endpoint dependency supplies authentication authority.

The installing subject is registration metadata, not an allowed-user list or a
Workspace id. Browser app claims must match an explicitly configured
APP_CAPSULE_ID. Any matching-app account may sign in and /api/auth/me confirms
that identity. The shared Drive is private: each data request revalidates the
same subject, exact Capsule and current owner/member role through UserInfo.
An ordinary signed-in account has no Drive sharing grant and receives 403 for
reads and mutations. Modern cookies encrypt the retained OAuth token with
AES-GCM bound to issuer/client/Capsule context; HMAC legacy cookies never carry
new app authority. Storage has no separate management surface, and /api/auth/me
does not expose cached roles as current authority. Expired/revoked tokens or
unavailable UserInfo deny private data access; the request has a ten-second
UserInfo deadline. Users must sign in again after token expiry; this consumer
does not refresh tokens.
Legacy Workspace-only claims keep the APP_WORKSPACE_ID membership restriction.
Object and MCP Interface authorization remain separate; this declaration does
not qualify their selected-host authority.

Both modules accept optional takosumi_capsule_id/takosumi_workspace_id inputs
and bind APP_CAPSULE_ID plus optional legacy APP_WORKSPACE_ID. Capsule-only
configuration is supported; the Workspace id is never required for app claims.
The portable module uses
WorkerVersion vars_json only for these non-secret ids. The v2.5 manifest
explicitly declares capsule_id/workspace_id context input sources. Takosumi
validates and compiles those proposals into its service-owned InstallConfig
context mapping, which supplies authenticated ledger identities at Run
preparation. They are not user-entered identity fields. The existing OIDC
runtime recipe continues to deliver only its sensitive bindings.
Without the expected app id, new app claims fail closed; an incoming claim is
never used to infer that id. The direct adapter retains its operator-provided
APP_URL/session-secret and validates any registered callback against that origin.

The selected Host must actually support Provider4 runtime inputs, its origin
reservation, and the matching credential recipe. Source/compiler/local synthetic
OAuth tests do not prove that live capability, and no anonymous fallback exists.
A missing origin, session secret or identity fails closed. Plan/resource and cost
review, explicit Apply, and an actual authenticated browser check remain required
for every new installation. Non-empty bucket export/purge remains a separate
reviewed lifecycle action; no existing installation is changed by this source.
