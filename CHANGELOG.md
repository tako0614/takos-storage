# Changelog

## 0.3.0

- Replaced app-local `tksvc_` HMAC grants with exact Takosumi Interface OAuth verification.
- Isolated `/o` data by resolved InterfaceBinding id.
- Added `mcp.invoke` Interface OAuth while retaining an explicit direct/self-host bearer option.
- Removed generated signing, MCP, admin, and session credentials plus all credential Outputs.
- Removed reserved `app_deployment` / `service_exports` Outputs and the Takosumi provider wrapper.
- Added restartable legacy-key migration and provider-credential pre-destroy R2 cleanup with the canonical Takosumi provider-configuration envelope and explicit direct mode.
- Kept the random provider as a v0.2.x state-destroy bridge only; no random resources remain.
