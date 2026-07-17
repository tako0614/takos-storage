# Takos Storage

Takos Storage は `storage.object` 相当の HTTP object API と、ユーザー向け drive / MCP を提供する standalone Capsule です。Takos worker の内部 service でも、Takosumi Cloud の closed storage 実装でもありません。

この repository の install 入力は root の plain OpenTofu module です。Takosumi 専用 manifest、予約 Output schema、Takosumi provider は必要ありません。Worker の prebuilt artifact は GitHub Release から取得できます。

## Runtime authorization

managed runtime の `/o` と `/mcp` は Takosumi Accounts が発行する invocation-only Interface OAuth credential を使います。Worker は current Core state を再検証する Accounts UserInfo を authority として、次を毎 request 検証します。

- `token_use = interface_oauth`
- canonical resource URI と完全一致する `aud`
- operation ごとの単一 permission (`storage.object.read` / `write` / `delete` / `list`、または `mcp.invoke`)
- owning Workspace / Capsule と non-empty Principal subject
- well-formed な Interface id / InterfaceBinding id / positive resolved revision evidence

`/o` の object は `interface-bindings/<binding-id>/` 以下に保存されるため、別の InterfaceBinding から同じ相対 key は見えません。旧 `tksvc_` HMAC、共有 signing key、standing admin token はありません。

Interface と InterfaceBinding は Takosumi の service-side blueprint / DB state が所有します。module は `api_url`、`mcp_url`、`launch_url` などの普通の Output だけを返し、Takosumi 側が必要な Output を Interface document input に明示 mapping します。

service-side blueprint の対応は次の通りです（この表は module manifest ではありません）。

| Interface   | resource URI input | permissions                                                                                   |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------- |
| object API  | `api_url`          | `storage.object.read`, `storage.object.write`, `storage.object.delete`, `storage.object.list` |
| MCP         | `mcp_url`          | `mcp.invoke`                                                                                  |
| launcher UI | `launch_url`       | user navigation only                                                                          |

InstallConfig は Accounts issuer、owning Workspace id、Capsule id を module input へ渡します。Accounts は UserInfo の成功応答前に Interface / InterfaceBinding / current resolved revision / subject / permission / resource ownership を Core で再検証し、stale・revoked・retired な credential を fail closed にします。Worker は成功応答の Interface evidence shape を検証しますが、apply 後に初めて確定する Interface id / Binding id / revision を module input や静的 env に固定しません。InterfaceBinding の grant/revoke/revision authority は Takosumi 側だけが持ちます。

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
  -var takosumi_capsule_id=<capsule-id>
```

`public_url` と `takosumi_accounts_issuer_url` は path / query / fragment / userinfo を持たない HTTPS origin を指定します（末尾 `/` は正規化されます）。これにより Worker の `APP_URL`、Output の audience、Accounts の OAuth/UserInfo endpoint が常に同じ origin 契約を使います。

deployed Worker では public URL、Accounts issuer、Workspace/Capsule が必須です。Interface の current-state authority は invocation ごとの Accounts UserInfo にあり、初回 apply を Interface の事後生成 id/revision に依存させません。drive sign-in も有効化する場合は `takosumi_accounts_client_id` と operator-managed secret の `app_session_secret` を明示指定してください。module は credential を生成せず、credential を Output に返しません。

ordinary outputs:

- `launch_url`, `api_url`, `mcp_url`
- `service_runtime_name`, `service_runtime_resource_id`, `service_runtime_managed_by_opentofu`
- `object_bucket_name`, `cloudflare_account_id`, `oidc_redirect_uri`

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

R2 bucket は non-empty のまま destroy できないため、destroy 前に provider credential と確認済みの `object_bucket_name` / `cloudflare_account_id` を使って purge します。公開 admin endpoint は使いません。Takosumi lifecycle runner は解決した全 binding の検証済み non-secret provider configuration を canonical `takosumi.provider-configurations@v1` envelope (`TAKOSUMI_PROVIDER_CONFIGS_JSON`) で渡します。default Cloudflare entry の `configuration: {}` または公式 `base_url` は Cloudflare の default API + workers.dev invocation を使い、custom `base_url` は provider が返した一時 cleaner origin を使います。`base_url` は API 実行方法だけを選び、managed capacity・billing・credential authority を意味しません。envelope または default Cloudflare entry が無ければ lifecycle cleanup は fail closed です。

direct/self-host invocation は Takosumi lifecycle envelope と混ぜず、`TAKOS_STORAGE_CLOUDFLARE_API_MODE=direct` を明示します。

```sh
TAKOSUMI_OUTPUTS_JSON="$(tofu output -json)" \
CLOUDFLARE_API_TOKEN=... \
TAKOS_STORAGE_CLOUDFLARE_API_MODE=direct \
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
