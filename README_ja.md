# Cloudflare Workers 上の LLM プロキシ

[English](README.md) | 日本語

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers)

[Cloudflare Workers](https://developers.cloudflare.com/workers/) 上で複数の LLM API を
1つの認証済みエンドポイントにまとめる、サーバーレスプロキシです。

## 主な機能

- OpenAI 互換の Chat Completions・Responses と Anthropic 互換の Messages
- プロバイダー固有 API のパススルーとモデル一覧の集約
- 複数 API キーの自動切り替え、認証情報のグループ管理、リクエスト単位のキー指定
- 複数プロバイダーへの順次フォールバックを設定できる仮想モデル
- カスタム OpenAI 互換エンドポイントの追加
- Cloudflare AI Gateway との連携
- 認証付きのプロバイダー認証情報の診断

API の対応範囲はプロバイダーごとに異なります。Responses と Messages は対応する
ネイティブ API を優先し、非対応時の変換機能は実験的です。対応項目と制限は
[API ガイド](docs/user/api/overview.md) を参照してください。

## 対応プロバイダー

OpenAI、Anthropic、Google AI Studio、Vertex AI、Amazon Bedrock、Azure OpenAI、
Workers AI、OpenRouter、OpenCode Zen/Go、DeepSeek、Groq、xAI、Cerebras、Cline、
Cohere、Hugging Face、Mistral、NVIDIA NIM、Ollama、Perplexity、Replicate。
ルート名、認証情報、追加要件は
[プロバイダー設定](docs/user/configuration.md#provider-credentials) に記載しています。

## クイックスタート

Node.js 22.12 以降、npm、Cloudflare アカウント、1つ以上のプロバイダー認証情報が必要です。

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers.git
cd llm-proxy-on-cloudflare-workers
npm ci
npm run cf:login
npm run secrets
npm run deploy
npm run secrets:deploy
```

`npm run secrets` で、十分に長く一意な `PROXY_API_KEY` とプロバイダー認証情報を
設定します。設定方法、名前付き環境、デプロイ後の確認は
[初期セットアップ](docs/user/initial-setup_ja.md) を参照してください。

## 使用例

プロキシのキーと、プロバイダー名を含むモデル ID を指定します。

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.6-sol",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

設定済みモデルは `GET /v1/models` で取得できます。プロバイダー固有の機能には
[パススルールート](docs/user/api/provider-pass-through.md) を使用します。

## ドキュメント

- [初期セットアップ](docs/user/initial-setup_ja.md) ([English](docs/user/initial-setup.md))
- [設定リファレンス](docs/user/configuration.md)
- [HTTP API とルーティング](docs/user/api/overview.md)
- [運用・トラブルシューティング](docs/user/operations.md)
- [全ガイド・設計資料](docs/index.md)
