# 初期セットアップ

最小構成のプロキシをデプロイし、動作確認するまでの手順です。全設定項目は英語版の
[Configuration reference](configuration.md) を参照してください。

## 前提条件

- Node.js 22.12 以降と npm
- Workers と Secret を作成できる Cloudflare アカウント
- 対応プロバイダーのキーを1つ以上

## 1. インストール

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers.git
cd llm-proxy-on-cloudflare-workers
npm ci
```

## 2. Wrangler の認証

```bash
npm run cf:login
```

Worker を所有する Cloudflare アカウントでブラウザー認証を完了します。Worker の既定名は
`llm-proxy` です。変更する場合は初回デプロイ前に `wrangler.jsonc` の `name` を
編集してください。

## 3. ローカル設定の作成

```bash
npm run secrets:create
```

または `config.example.jsonc` を `config.jsonc` にコピーして編集します。十分に長く一意な
`PROXY_API_KEY` と、1つ以上のプロバイダーキーを設定してください。

```jsonc
{
  "$schema": "schemas/config-schema.json",
  "PROXY_API_KEY": "replace-with-a-long-random-value",
  "OPENAI_API_KEY": "replace-with-your-provider-key",
}
```

実値を含む設定ファイルは Git の対象外です。コミット前に `git status --short` で確認して
ください。

## 4. デプロイ前の確認

```bash
npm run tsc
npm run lint
npm test
npm run secrets:deploy -- --dry-run
```

ドライランは設定名だけを表示し、値、先頭文字列、長さをすべて伏せます。

## 5. コードと設定のデプロイ

```bash
npm run deploy
npm run secrets:deploy
```

前者は Worker のコードとバインディング、後者は `config.jsonc` の空でない値を Worker
Secret として登録します。設定を変更したら後者を再実行してください。

## 6. 動作確認

Wrangler が表示した URL に置き換えて実行します。

```bash
curl https://your-worker.example/ping \
  --header "Authorization: Bearer $PROXY_API_KEY"

curl https://your-worker.example/status \
  --header "Authorization: Bearer $PROXY_API_KEY"

curl https://your-worker.example/v1/models \
  --header "Authorization: Bearer $PROXY_API_KEY"
```

`/ping` は `Pong` を返します。`/status` には認証情報スロット数と設定メタデータが
含まれるため、出力は非公開で確認してください。`/v1/models` はベストエフォートであり、
タイムアウトや一覧取得非対応のプロバイダーは省略されます。

次は英語版の [HTTP API and routing](api.md) を参照してください。名前付き環境、
キーローテーション、AI Gateway、カスタムエンドポイントは
[Configuration reference](configuration.md) と
[Operations and troubleshooting](operations.md) に記載しています。
