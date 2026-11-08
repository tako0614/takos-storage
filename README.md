# Takos Storage

Takos Storage は `storage.object` 相当の HTTP object API と、ユーザー向け drive / MCP を提供する standalone Capsule です。Takos worker の内部 service でも、Takosumi Hosted の closed storage 実装でもありません。

この repository の install unit は plain OpenTofu module です。root は direct
Cloudflare、`deploy/takoform` は portable managed graph です。Worker の prebuilt
artifact は GitHub Release で配布し、portable module は選択した Takoform Host に
事前 commit された content-addressed `WorkerBundle` manifest digest だけを参照します。
OpenTofu module 内で外部コマンドや download data source は実行しません。

## Runtime authorization

managed runtime の `/o` と `/mcp` は Takosumi Accounts が発行する invocation-only Interface OAuth credential を使います。Worker は current Core state を再検証する Accounts UserInfo を authority として、次を毎 request 検証します。

- personal呼出しの`token_use = interface_oauth`（`/o`の明示的なapp-shared用途は下記）
- canonical resource URI と完全一致する `aud`
- operation ごとの単一 permission (`storage.object.read` / `write` / `delete` / `list`、または `mcp.invoke`)
- configured Capsule と non-empty Principal subject（Workspace は設定した場合だけ互換照合）
- well-formed な Interface id / InterfaceBinding id / positive resolved revision evidence

ブラウザーの shared Drive は private です。アプリにサインインできることと、Drive のデータを使えることは別で、app-scoped session の read/write は同じ subject・期待 Capsule・現在の owner/member、または app_role 未発行時の同一 Workspace 会員を UserInfo で毎 request 確認します。一般利用者はサインイン後の `/api/auth/me` を利用できますが、共有 grant がないため Drive は 403 です。設定済み Capsule claim のない旧 session cookie は `/api/auth/me` と `/api/drive` で削除して再サインインを求めます。現在の Capsule に一致する signed-in user でも membership がなければデータアクセスは 403 のままです。`APP_CAPSULE_ID` が未設定の未更新 self-host install は、旧 workspace-only cookie と `APP_WORKSPACE_ID` membership の互換規則を維持します。明示的な `ALLOW_UNAUTHENTICATED_DRIVE` の公開設定も維持します。新 session 内の OAuth token は issuer/client/Capsule に結び付けた AES-GCM で暗号化します。UserInfo が token 期限切れなどで 401 を返すと session を削除し、既存 UI の再ログインへ進みます。

App sign-in を更新するときは、consumer apps を先に deploy し、Takosumi Accounts の open sign-in writer B (#657) を最後に deploy します。Accounts の共通 `AppRole` は `owner` / `member` で、現在の owner/member role と完全一致する Capsule claim が private Drive access を許可します。`app_role` 発行前の互換期間は同じ Capsule に結び付く旧 Workspace membership を使います。未更新の self-host Storage install は引き続き Workspace membership を必要とするため、Capsule 設定へ移行するまでは `APP_WORKSPACE_ID` と Workspace membership を維持してください。

personalな`/o`のobjectは`interface-bindings/<binding-id>/`以下に保存されるため、別のInterfaceBindingから同じ相対keyは見えません。旧`tksvc_` HMAC、共有signing key、standing admin tokenはありません。

共有データ用途に対応したCore/Accountsで、consumer Appとproviderの間に`oauth2.app-data.v1`のLinkを明示承認した場合、`/o`は別用途の`token_use = interface_app_data`も受け取ります。
現在のUserInfoが返す`takosumi.app_data`について、`takosumi.interface-app-data/v1`のclosed schema、
`appd_`付きnamespace、consumer/provider Capsule、owner/member、consumerとprovider双方のownership epoch、Link/Binding/Interfaceのgenerationを検査します。
この用途はexactな`APP_CAPSULE_ID`が必須で、Workspace設定やcallerのnamespace指定では代用できません。
Accounts/Coreが現在のmember・Link・Binding・permissionを再検証した応答だけを使い、個々のPrincipal subjectとBindingを維持したまま、
同じApp namespaceのobjectを`interface-app-data/<namespace-id>/`以下で共有します。MCPとブラウザーDriveはこの新用途を受け付けません。

既存のpersonal保存先はそのまま残り、新用途への自動移動・統合はしません。既存consumerの切替時は、
データの移行と回復手順を別途確認してください。sourceの対応だけで既存サービスの設定やデータを変更することはありません。

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

### Interrupted deletion cleanup

削除のphysical cleanupに失敗した項目は、Driveの「削除の後処理」に表示します。
一覧の続きは「さらに読み込む」でcursorをたどれます。取得済みpageの通常fileと削除途中の項目を保持し、
古いpageの遅延応答で新しい一覧を巻き戻しません。フォルダ全体の操作は、従来どおり一覧が途中なら拒否します。

`GET /api/drive/list` は、そのpageにmarkerがある場合に `pending_deletions` を返します。
各項目はrelative `path` と、読取検査の候補になる `cleanup_revision` のみです。revisionはpathと現在marker ETagから計算した
公開SHA-256 digestで、認可やmetadata世代の証明ではありません。内部のnonce/現在ETagは返しません。
通常GET/HEADとMCP/Objectのmarker非表示は維持します。

「後処理を確認」で同じ画面のdialogを開くと、`GET /api/drive/cleanup?path=...&cleanup_revision=...` が選択した項目だけを読取検査します。
UUIDv4形式・現在revisionの確認が成功するまで確定ボタンを有効にしません。不明形式はoperator確認を表示します。
全markerのbodyを一覧取得時に走査しません。取消し・別dialogのあとに届く古い読取からの表示変更や401遷移も拒否します。

利用者が確認した `POST /api/drive/cleanup` は `{path, cleanup_revision}` のJSON（最大8 KiB）を受け、
既存Drive認証・CSRF・namespace、現在のmarker・revisionとfresh UUIDv4形式を検査します。
内部の現在ETagを使って別のfresh nonceへCAS遷移してからphysical cleanupします。
通常fileとして再作成済みの場合は409、revisionが違えば412で変更しません。cleanup後はcreate-onlyでパスを再利用できます。
旧empty/不正formatやrevision不明のmarkerは管理者確認として残し、自動で消しません。

もう一度cleanupが失敗すると503 `cleanup_incomplete` になり、応答喪失も含めてUIは成功扱い・自動再送をしません。
一覧を再読して、必要なら新しいrevisionに対する明示確認を行います。確認中のrevisionは一覧更新で差し替えません。
同bytes metadata/ABAや、guardを通らない直接R2 writerまでの世代保証は追加しません。旧formatのoperator repairは別途必要です。

### Browser folder operations

Driveのフォルダメニューから、内容を確認して名前変更・削除できます。確認ダイアログを開いた時点の
path/ETag一覧を固定し、`POST /api/drive/folder` へ `operation` (`rename` / `delete`)、
`source_path` (末尾 `/`)、`entries` (`{path, etag}` の配列)を送ります。
renameには末尾 `/` の `destination_path` も必要です。認証・CSRFと保存先は既存Driveと同じです。

serverはsource prefixの全pageと確認済み一覧を照合し、未確認の追加・更新・削除、残留削除markerを
変更前に拒否します。root、重複path、prefix外、移動元/先の重複・包含を拒否し、移動先は空である必要があります。
最大128件、request JSONは256 KiB、renameは既存の1件50 MiB制限と合計128 MiBまでです。
UIの一覧が途中で切れている場合は操作できません。上限超過は一件も変更する前に413を返します。

各objectを条件付きでコピー・削除するため、フォルダ全体のatomic transactionではありません。
copyはHTTP/custom metadataを保持し、移動元の削除に失敗してもfolder操作ではcopyを自動rollbackしません。
途中競合・cleanup失敗・処理中に増えたsource memberでは409 `folder_operation_incomplete` と、
確認済み `completed`、未処理/不確実な `remaining`、必要なら `failed_path` を返します。
UIは結果を表示して一覧を更新し、自動再送しません。両方のpathを確認してから次の操作をしてください。
応答を失った場合も成功と表示せず、手動確認を求めます。完了は最後の読取時点のsnapshotについてであり、
以後の作成や同bytes metadata変更/ABAまで止める保証ではありません。

| Method     | Path            | Authorization                                          |
| ---------- | --------------- | ------------------------------------------------------ |
| GET        | `/healthz`      | none                                                   |
| GET        | `/`, `/ui`      | browser OIDC session when enabled                      |
| POST       | `/mcp`          | `mcp.invoke` Interface OAuth or explicit direct bearer |
| PUT        | `/o/<key>`      | `storage.object.write`                                 |
| GET / HEAD | `/o/<key>`      | `storage.object.read`                                  |
| DELETE     | `/o/<key>`      | `storage.object.delete`                                |
| GET        | `/o?prefix=<p>` | `storage.object.list`                                  |

`PUT /o/<key>` は条件を省略すると新規作成専用です。既存objectの更新はGET/HEADで得た
strong quoted `ETag` を `If-Match` に指定し、明示作成には `If-None-Match: *` を使います。
両条件の同時指定・不正形式は400、条件不一致は412です。`DELETE` は同じ `If-Match` が必須で、
未指定428・不正形式400・不一致412になります。従来の無条件上書き・削除callerは条件を配送してください。
OfficeのJSON fetchのため正当なmedia typeとbytesは保持し、GET/HEADにattachment、nosniff、
sandbox/default-src-none CSPを付けます。これは配備先browserでの検証を代替しません。

object APIもDrive/MCPと同じ論理削除markerを使います。物理cleanup失敗は成功ACKにせず、
残留markerはGET/HEAD/listに表示しません。旧ETag更新と新規作成を拒否し、operator repairが必要です。
ETagのcontent/metadata/ABAの限界は下記MCPと同じです。personalはInterfaceBindingごと、明示的なapp-shared用途は検証済みApp namespaceごとの保存先を使い、operation権限と条件付き更新は同じです。

## MCP file operations

MCP の6つの file tool はブラウザー Drive と同じ `drive/` 領域を使います。
認証済みの caller でも、別の更新を無条件に上書き・削除することはできません。
`storage_file_read` / `storage_file_info` が返す quoted `etag` を次の操作へ渡します。

- `storage_file_write`: `expected_etag` を省略すると新規作成専用です。既存 file の更新には現在の `expected_etag` が必要で、成功応答は更新後の `etag` を返します。
- `storage_file_delete`: 現在の `expected_etag` が必須です。
- `storage_file_move`: `expected_source_etag` が必須で、移動先は既定で新規作成専用です。既存の移動先を置換する場合は `overwrite: true` と、その file の現在の `expected_destination_etag` を指定します。

これまで同じ path を無条件更新した MCP caller は、先に read/info を行い ETag を配送する必要があります。
不足・不正・競合は MCP の `result.isError: true` で返します。HTTP 200 は tool 成功を意味しません。
再送前に現在の file を読み、変更内容を確認してください。認証と `drive/` の保存先は変わりません。

ETag は content validator であり upload generation ではありません。同じ bytes のまま HTTP metadata
だけが変わる場合や ABA の全世代を区別する保証はありません。move は atomic rename ではなく、
copy 後に source を条件付き削除します。新規宛先への move は既存の条件付き rollback を試みます。
既存宛先の置換後に source removal が失敗した場合は、宛先を自動復元・削除せず、copy を保持して
`move_incomplete` を返します。source と destination の両方を再読し、手動で結果を照合してください。

削除の物理 cleanup が失敗すると、論理削除済みの marker が残ることがあります。read/info/list には
表示せず、旧 ETag の更新と新規作成も拒否します。これは自動復旧ではなく、operator による別の cleanup が必要です。

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
