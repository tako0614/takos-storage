# Takos Storage

Takos Storage は `storage.object` 相当の HTTP object API と、ユーザー向け drive / MCP を提供する standalone Capsule です。Takos worker の内部 service でも、Takosumi Hosted の closed storage 実装でもありません。

この repository の install unit は plain OpenTofu module です。root は direct
Cloudflare、`deploy/takoform` は portable managed graph です。Worker の prebuilt
artifact は GitHub Release で配布し、portable module は選択した Takoform Host に
事前 commit された content-addressed `WorkerBundle` manifest digest だけを参照します。
OpenTofu module 内で外部コマンドや download data source は実行しません。

## Runtime authorization

managed runtime の `/o` と `/mcp` は Takosumi Accounts が発行する invocation-only Interface OAuth credential を使います。Worker は current Core state を再検証する Accounts UserInfo を authority として、次を毎 request 検証します。

- `token_use = interface_oauth`
- canonical resource URI と完全一致する `aud`
- operation ごとの単一 permission (`storage.object.read` / `write` / `delete` / `list`、または `mcp.invoke`)
- configured Capsule と non-empty Principal subject（Workspace は設定した場合だけ互換照合）
- well-formed な Interface id / InterfaceBinding id / positive resolved revision evidence

ブラウザーの shared Drive は private です。アプリにサインインできることと、Drive のデータを使えることは別で、app-scoped session の read/write は同じ subject・期待 Capsule・現在の owner/member、または app_role 未発行時の同一 Workspace 会員を UserInfo で毎 request 確認します。一般利用者はサインイン後の `/api/auth/me` を利用できますが、共有 grant がないため Drive は 403 です。明示的な `ALLOW_UNAUTHENTICATED_DRIVE` の公開設定と旧 workspace-only cookie の互換規則は維持します。新 session 内の OAuth token は issuer/client/Capsule に結び付けた AES-GCM で暗号化します。UserInfo が token 期限切れなどで 401 を返すと session を削除し、既存 UI の再ログインへ進みます。

`/o` の object は `interface-bindings/<binding-id>/` 以下に保存されるため、別の InterfaceBinding から同じ相対 key は見えません。旧 `tksvc_` HMAC、共有 signing key、standing admin token はありません。

Interface 宣言は repository manifest、InterfaceBinding と runtime state は Takosumi が所有します。module は `api_url`、`mcp_url`、`launch_url` などの普通の Output だけを返し、Takosumi 側が必要な Output を Interface document input に明示 mapping します。

service-side blueprint の対応は次の通りです（この表は module manifest ではありません）。

| Interface   | resource URI input | permissions                                                                                   |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------- |
| object API  | `api_url`          | `storage.object.read`, `storage.object.write`, `storage.object.delete`, `storage.object.list` |
| MCP         | `mcp_url`          | `mcp.invoke`                                                                                  |
| launcher UI | `launch_url`       | user navigation only                                                                          |

両 module は install context の `takosumi_capsule_id` を `APP_CAPSULE_ID` へ渡し、設定された場合はブラウザー app claim と Interface OAuth の対象 Capsule を必ず照合します。未設定の既存インストールは、設定済み `APP_WORKSPACE_ID` による旧経路を利用できます。`takosumi_workspace_id` / `APP_WORKSPACE_ID` は旧 workspace 形式を照合する任意の互換設定です。Workspace を省略しても exact Capsule・audience・permission・InterfaceBinding evidence が揃えば利用できます。Accounts は UserInfo の成功応答前に Interface / InterfaceBinding / current resolved revision / subject / permission / resource ownership を Core で再検証します。Worker は完全な evidence shape を検証し、stale・revoked・廃止済みの credential を安全側に停止します。InterfaceBinding の grant/revoke/revision authority は Takosumi 側だけが持ちます。

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

portable Worker では endpoint origin・Accounts issuer・期待する Capsule id が必要で、endpoint origin は request から exact audience として解決できます。v2.5 manifest の `capsule_id` context input を検証・compile した service-owned InstallConfig が、期待 Capsule id を `takosumi_capsule_id` へ配送します。Workspace id は任意です。invocation ごとの Accounts UserInfo evidence を期待 Capsule と照合し、初回 apply を Interface の事後生成 id/revision に依存させません。drive sign-in も有効化する direct/self-host module では `takosumi_accounts_client_id` と operator-managed secret の `app_session_secret` を明示指定してください。portable module は launcher をまだ宣言しません。module は credential を生成せず、credential を Output に返しません。

ordinary outputs:

- `launch_url`, `api_url`, `mcp_url`
- `service_runtime_name`, `service_runtime_resource_id`, `service_runtime_managed_by_opentofu`
- `object_bucket_name`, `cloudflare_account_id`, `oidc_redirect_uri`

[`install-options.json`](install-options.json) は導入元を選ぶ任意の
`CapsuleSourceOptions` 文書です。[`.well-known/takosumi.json`](.well-known/takosumi.json)
は別の一般 `Repository` manifest で、`deploy/takoform` を既定 module とし、root の
direct module も同じ Git commit から選択可能にします。secret、provider credential、
Cloudflare account、Interface grant、実行権限は含みません。Takosumi は検証後に
DB-owned InstallConfig へ compile して通常の Plan / Apply を行います。

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

R2 bucket は non-empty のまま destroy できないため、destroy 前に provider credential と確認済みの `object_bucket_name` / `cloudflare_account_id` を使って purge します。公開 admin endpoint は使いません。Takosumi lifecycle runner は解決した全 binding の検証済み non-secret provider configuration を canonical `takosumi.provider-configurations@v1` envelope (`TAKOSUMI_PROVIDER_CONFIGS_JSON`) で渡します。default Cloudflare entry の `configuration: {}` または公式 `base_url` は Cloudflare の default API + workers.dev invocation を使い、custom `base_url` は provider が返した一時 cleaner origin を使います。`base_url` は API 実行方法だけを選び、managed capacity・billing・credential authority を意味しません。envelope または default Cloudflare entry が無ければ lifecycle cleanup は安全側に停止します。

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

direct Cloudflare向けのrelease tagと `package.json` は同じversionにします。
release workflowは `worker.js`、SHA-256、`takosumi-artifact.json` を公開します。
portable `deploy/takoform` は選択したsourceの `sourceBuild` でWorkerを構築し、
Provider 4.1.0でそのbytesをHostへ渡します。旧 `worker_bundle_manifest_digest`
入力や既存tagの上書きは使いません。実Hostのruntime-input能力と正規Plan/Applyの
成立は、source/合成回帰とは別に確認します。
