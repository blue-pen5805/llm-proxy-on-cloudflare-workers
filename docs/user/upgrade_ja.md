# 1.0.0 へのアップグレード

[English](upgrade.md) | 日本語

既存のデプロイを更新する手順です。1.0.0 のソースコードが手元にあることを前提と
しています。バージョン番号の更新だけでは、リリースタグの公開は意味しません。
新規作成の場合は[初期セットアップ](initial-setup_ja.md)を参照してください。

## 1. 現在の設定を保存する

稼働中のコードのリビジョン、Cloudflare アカウント、Worker 名、ルート、カスタム
ドメイン、バインディング、名前付き環境を控えてください。使用中の `config.jsonc`
または `config.<env>.jsonc` とデプロイ設定を、安全な場所にバックアップします。
既存の設定を `config.example.jsonc` で上書きしないでください。

Node.js 22.18 以降を使い、1.0.0 のソースディレクトリで実行します。

```bash
npm pkg get version
npm ci
npm run cf:login
```

バージョンの出力が `"1.0.0"` であることを確認してください。Wrangler で認証済みでも
`cf` には個別のログインが必要です。設定エディターは `npm run secrets` で開きます。

## 2. 更新先の Worker を合わせる

デプロイ設定は `cloudflare.config.ts` です。運用中の設定から Worker 名、ルート、
カスタムドメイン、バインディングなどを反映し、既存の Worker と同じ更新先にします。
既定の名前のまま別の Worker を作成しないよう確認してください。

標準では既定の `llm-proxy` と `develop` モードの `llm-proxy-develop` が定義されて
います。他のモードを使う場合は、先に `cloudflare.config.ts` に定義してください。

`KeyRotationManager` の削除宣言は残してください。この Durable Object の名前空間が
存在するデプロイでは、廃止処理に必要です。キー巡回は Worker インスタンスごとに
行われ、以前の巡回状態は削除されます。名前空間を必要とする古いコードへ戻す場合、
コードのロールバックだけで名前空間が復元されるとは限りません。
[デプロイ設計](../developer/design/features/security_config.md#deployment-tooling)と
[cf 設定の対応表](https://developers.cloudflare.com/cf/wrangler/reference/)を参照してください。

### Cloudflare Workers Builds の設定も変更する

Git 連携の Workers Builds を使っている場合は、次の自動デプロイ前に、
**リポジトリだけでなく Cloudflare ダッシュボード側のビルド設定も変更してください。**
**Workers & Pages → 対象の Worker → Settings → Build** を開き、設定を編集します。

| 設定項目                             | 既定の Worker に指定する値                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Build command（ビルドコマンド）      | `npm run build`                                                                                     |
| Deploy command（デプロイコマンド）   | `npm run deploy -- --prebuilt`                                                                      |
| Root directory（ルートディレクトリ） | `package.json` と `cloudflare.config.ts` のあるディレクトリ。このプロジェクトではリポジトリのルート |
| Production branch（本番ブランチ）    | リリースをデプロイするブランチ。通常は `main`                                                       |

保存されている `npx wrangler deploy` は置き換えてください。このプロジェクトは
`cloudflare.config.ts` を使い、`wrangler.jsonc` は含みません。npm スクリプト経由で
プロジェクトが固定しているバージョンの `cf` を実行します。

`npm run build` と `npm run deploy` の組み合わせでも動作しますが、`cf deploy` は
通常ビルドも行うため、二度ビルドされます。上表では `--prebuilt` を付け、直前の
ビルドで生成した `.cloudflare/output` をそのままデプロイします。
ビルドコマンドを空欄にして、デプロイコマンドだけ `npm run deploy` にする方法もあります。

別 Worker の `develop` モードでは、ビルドを `npm run build -- --mode develop`、
デプロイを `npm run deploy -- --prebuilt --mode develop` にします。両者のモードは
一致させてください。このリポジトリの既定の Worker はモード指定なしで動作します。
設定に存在しない `--mode production` は付けないでください。

ビルド環境の Node.js は 22.18 以降にします。CI の認証には `CLOUDFLARE_API_TOKEN`
と `CLOUDFLARE_ACCOUNT_ID` を使うため、Workers Builds のトークン・アカウント設定が
対象 Worker に合っているか確認してください。CI で対話式の `cf:login` は実行しません。
実行時のプロバイダーシークレットはビルド変数とは別です。ビルド・デプロイコマンドは
Git 管理外の `config.jsonc` をアップロードしないため、実行時設定は手順 4 で別途反映します。

プレビュービルドを有効にしている場合は、別項目の Preview command も変更します。
cf では `npx cf previews deploy` がプレビュー用のビルドとデプロイを行います。
通常ビルドの成果物を `--prebuilt` で渡したり、本番用のデプロイコマンドを指定したり
しないでください。`--mode` を付ける場合は、明示的に定義したモードを使います。

公式資料：[Workers Builds の設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、
[cf の CI 利用](https://developers.cloudflare.com/cf/ci/)、
[ビルド済み成果物とモードの扱い](https://developers.cloudflare.com/cf/projects/#deploy-a-prebuilt-build)。

## 3. 設定とクライアントを確認する

可能な限り既存のプロキシキーを維持すれば、クライアントの認証情報を変更せずに済みます。
設定と連携先が次の 1.0.0 の要件を満たすことを確認してください。

| 項目           | 必要な設定・動作                                                                                                                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 認証           | `Authorization: Bearer <key>`、`x-api-key`、`x-goog-api-key` のいずれかを使用します。URL クエリでの認証はできません。本番ではプロキシキーが必須で、`DEV` は無視されます。                                                                               |
| 複数キー       | `["example-key-one", "example-key-two"]` のような JSON 配列にします。文字列中のカンマは１つのキーの一部です。                                                                                                                                           |
| カスタム接続先 | HTTPS、組み込みプロバイダーと重複しない一意の名前、[設定上限](configuration.md#custom-openai-compatible-endpoints)を満たす必要があります。                                                                                                              |
| 仮想モデル     | カスタム接続先をデプロイするとき、`VIRTUAL_MODELS` の省略は `null` と同じ扱いになり、配備済みの仮想モデル設定を削除します。使っている場合は最終的な設定値を含めてください。仮想モデルを設定し、カスタム接続先を省略した場合も、接続先設定を削除します。 |
| 部分更新       | 依存する２設定を両方省略した場合は、両方とも維持します。仮想モデルだけの削除では、カスタム接続先を維持します。明示的な空値は更新なしとして扱うため、削除には `null` を使います。                                                                        |
| キー巡回       | `ENABLE_GLOBAL_ROUND_ROBIN` を削除してください。巡回はインスタンスごとに行われ、全体の順序は保証されません。                                                                                                                                            |
| 監視           | `/status` はキーを `slot` で識別します。プロキシが返す OpenAI 形式のエラーは `error` オブジェクト内に `message`、`type`、`param`、`code` を持ちます。                                                                                                   |

カスタム接続先を設定していても、仮想モデルを一度も使っていなければ
`VIRTUAL_MODELS` キーを追加する必要はありません。デプロイ処理が省略を補い、
ローカルの設定ファイルは書き換えません。他の省略された設定は配備済みの値を維持します。
詳細は[設定更新のルール](configuration.md#configuration-files)を参照してください。

## 4. プレビュー・検証・デプロイを行う

Cloudflare を更新する前に、対象設定をプレビューします。

```bash
npm run secrets:deploy -- --dry-run
```

設定名と `[set]` / `[delete]` を確認し、依存するキーの省略で追加された削除も確認
してください。dry-run はオフラインで動作し、Cloudflare の権限までは確認しません。
先に別の Worker で検証してください。コードとシークレットは別々に更新されるため、
本番では両者の更新間隔も考慮して実施します。

既定の Worker は、コードを先に、その後シークレットをデプロイします。

```bash
npm run deploy
npm run secrets:deploy
```

標準の `develop` モードでは `config.develop.jsonc` を用意して実行します。

```bash
npm run secrets:deploy -- --env develop --dry-run
npm run deploy -- --mode develop
npm run secrets:deploy -- --env develop
```

コードとシークレットのモード名を一致させてください。独自のモード名は、あらかじめ
`cloudflare.config.ts` で定義する必要があります。

## 5. 動作確認と復旧準備

既存クライアントの認証情報で `/ping` が `Pong` を返すことを確認し、`/status` の内容を
非公開で確認します。`/v1/models` は `Cache-Control: no-cache` を付けて再取得します。
重要なプロバイダーごとに通常の推論とストリーミングを試し、使用中のカスタム接続先・
仮想モデル、診断情報・エラーを読み取る連携先も確認してください。

問題があれば[運用・トラブルシューティング](operations.md)を参照してください。
確認が終わるまで以前のコードと設定を保存します。コードとシークレットの履歴は
独立しているため、復旧時は互換性のある組み合わせを戻し、上記の Durable Object の
削除も考慮してください。
