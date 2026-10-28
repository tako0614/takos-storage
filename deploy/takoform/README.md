# Takos Storage Takoform Capsule

Select `deploy/takoform` explicitly for the portable Host, or `.` for direct
Cloudflare. The v2.4 repository manifest has no implicit default module.

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
values never enter module variables, vars_json or Outputs. The registered HTTPS
callback supplies the browser origin before Apply; no Request Host, guessed
hostname, or post-Apply endpoint dependency supplies authentication authority.

The installing subject is registration metadata, not an allowed-user list or a
Workspace id. Accounts keeps its current Capsule-bound grant and Workspace
membership checks. An explicit APP_WORKSPACE_ID retains the additional local
membership restriction. Object and MCP Interface authorization remain separate;
this declaration does not qualify their selected-host authority.
The direct adapter retains its operator-provided APP_URL/session-secret and
Workspace behavior, and validates any registered callback against that origin.

The selected Host must actually support Provider4 runtime inputs, its origin
reservation, and the matching credential recipe. Source/compiler/local synthetic
OAuth tests do not prove that live capability, and no anonymous fallback exists.
A missing origin, session secret or identity fails closed. Plan/resource and cost
review, explicit Apply, and an actual authenticated browser check remain required
for every new installation. Non-empty bucket export/purge remains a separate
reviewed lifecycle action; no existing installation is changed by this source.
