# Takos Storage

Takos Storage は `storage.object` 相当の HTTP object API と、ユーザー向け drive / MCP を提供する standalone Capsule です。Takos worker の内部 service でも、Takosumi Cloud の closed storage 実装でもありません。

この repository の install 入力は root の plain OpenTofu module です。Takosumi 専用 manifest、予約 Output schema、Takosumi provider は必要ありません。Worker の prebuilt artifact は GitHub Release から取得できます。

## Runtime authorization

managed runtime の `/o` と `/mcp` は Takosumi Accounts が発行する invocation-only Interface OAuth credential を使います。Worker は Accounts UserInfo を authority として、次を毎 request 検証します。

- `token_use = interface_oauth`
- canonical resource URI と完全一致する `aud`
- operation ごとの単一 permission (`storage.object.read` / `write` / `delete` / `list`、または `mcp.invoke`)
- owning Workspace / Capsule
- Interface / InterfaceBinding / resolved revision evidence
- service-side blueprint が渡した exact Interface id / current resolved revision

`/o` の object は `interface-bindings/<binding-id>/` 以下に保存されるため、別の InterfaceBinding から同じ相対 key は見えません。旧 `tksvc_` HMAC、共有 signing key、standing admin token はありません。

Interface と InterfaceBinding は Takosumi の service-side blueprint / DB state が所有します。module は `api_url`、`mcp_url`、`launch_url` などの普通の Output だけを返し、Takosumi 側が必要な Output を Interface document input に明示 mapping します。

service-side blueprint の対応は次の通りです（この表は module manifest ではありません）。

| Interface   | resource URI input | permissions                                                                                   |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------- |
| object API  | `api_url`          | `storage.object.read`, `storage.object.write`, `storage.object.delete`, `storage.object.list` |
| MCP         | `mcp_url`          | `mcp.invoke`                                                                                  |
| launcher UI | `launch_url`       | user navigation only                                                                          |

InstallConfig は同時に Accounts issuer、owning Workspace id、Capsule id、各 Interface id と current resolved revision を module input へ渡します。Worker は token evidence の revision が current value と一致しない場合に拒否します。InterfaceBinding の grant/revoke/revision authority は Takosumi 側だけが持ちます。

direct/self-host の `/mcp` だけは、operator が `published_mcp_auth_token` を明示設定できます。空なら static bearer は生成も state 保存もされません。`/o` は常に Interface OAuth が必要です。

## HTTP surface

| Method     | Path            | Authorization                                          |
| ---------- | --------------- | ------------------------------------------------------ |
| GET        | `/healthz`      | none                                                   |
| GET        | `/`, `/ui`      | browser OIDC session when enabled                      |
| POST       | `/mcp`          | `mcp.invoke` Interface OAuth or explicit direct bearer |
| PUT        | `/o/<key>`      | `storage.object.write`                                 |
| GET / HEAD | `/o/<key>`      | `storage.object.read`                                  |
| DELETE     | `/o/<key>`      | `storage.object.delete`                                |
| GET        | `/o?prefix=<p>` | `storage.object.list`                                  |

## OpenTofu

```sh
bun run build:worker
tofu init
tofu apply \
  -var enable_cloudflare_resources=true \
  -var enable_cloudflare_worker_script=true \
  -var cloudflare_account_id=<id> \
  -var public_url=https://storage.example \
  -var takosumi_accounts_issuer_url=https://accounts.example \
  -var takosumi_workspace_id=<workspace-id> \
  -var takosumi_capsule_id=<capsule-id> \
  -var takosumi_object_interface_id=<interface-id> \
  -var takosumi_object_interface_resolved_revision=1 \
  -var takosumi_mcp_interface_id=<interface-id> \
  -var takosumi_mcp_interface_resolved_revision=1
```

deployed Worker では public URL、Accounts issuer、Workspace/Capsule、object/MCP Interface id と resolved revision が必須です。revision が変わったら service-side reconcile が module input を更新します。drive sign-in も有効化する場合は `takosumi_accounts_client_id` と operator-managed secret の `app_session_secret` を明示指定してください。module は credential を生成せず、credential を Output に返しません。

ordinary outputs:

- `launch_url`, `api_url`, `mcp_url`
- `service_runtime_name`, `service_runtime_resource_id`, `service_runtime_managed_by_opentofu`
- `object_bucket_name`, `oidc_redirect_uri`

## v0.2.x から v0.3.0 への移行

v0.3.0 は旧 HMAC/static credential resources を削除します。最初の upgrade apply で旧 `random_id` state を destroy できるよう、`hashicorp/random = 3.9.0` は一リリースだけ upgrade bridge として残しています。新しい random resource は作りません。

旧 `/o` key を既存 InterfaceBinding に移す場合は、対象 prefix と binding id を人間が確認してから restartable migration を実行します。copy-only で元 key は rollback evidence として残り、既存 target と一致しなければ停止します。

```sh
CLOUDFLARE_API_TOKEN=... \
CLOUDFLARE_ACCOUNT_ID=... \
TAKOS_STORAGE_R2_BUCKET_NAME=... \
TAKOS_STORAGE_LEGACY_KEY_PREFIX=workspace/app \
TAKOS_STORAGE_INTERFACE_BINDING_ID=... \
bun run storage:migrate-binding-prefix
```

R2 bucket は non-empty のまま destroy できないため、destroy 前に provider credential と確認済みの `object_bucket_name` を使って purge します。公開 admin endpoint は使いません。

```sh
TAKOSUMI_OUTPUTS_JSON="$(tofu output -json)" \
CLOUDFLARE_API_TOKEN=... \
CLOUDFLARE_ACCOUNT_ID=... \
bun run storage:pre-destroy
```

## Development and release gates

```sh
bun test
bun run check
bun run build:worker
tofu fmt -check -recursive
tofu init -backend=false -lockfile=readonly
tofu validate
```

release tag と `package.json` / `worker_release_tag` は同じ version にします。release workflow は `worker.js`、SHA-256、`takosumi-artifact.json` を公開します。
