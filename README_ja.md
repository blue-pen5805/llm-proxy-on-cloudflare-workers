# Cloudflare Workers 上の LLM プロキシ

[English](README.md) | 日本語

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers)

[Cloudflare Workers](https://developers.cloudflare.com/workers/) 上で複数の LLM API を
1つの認証済みエンドポイントにまとめる、サーバーレスプロキシです。

## 主な機能

- OpenAI 互換の `POST /v1/chat/completions` と `GET /v1/models`
- 実験的な `POST /v1/responses`（内部で Chat Completions に変換）
- 実験的な Anthropic 互換 `POST /v1/messages`（内部で Chat Completions に変換）
- `/openai/v1/responses` などのプロバイダー別パススルールート
- Cloudflare AI Gateway のプロバイダールートとアカウントレベル REST API
- 複数のプロバイダーキーからランダム選択、またはストライプ方式のラウンドロビン選択
- `provider:profile` で選択できる名前付きプロバイダー認証情報プロファイル
- `/key/<index-or-range>` によるリクエスト単位のキー指定
- 設定ファイルで追加できるカスタム OpenAI 互換エンドポイント
- `/status` による認証済みの設定・プロバイダーキー診断

## 対応プロバイダー

ルート名は `openai/gpt-5.6-sol` のようにモデル ID の接頭辞にも使います。チャット変換、
モデル一覧、直接接続、AI Gateway の対応範囲はプロバイダーごとに異なります。利用する
組み合わせの詳細は [HTTP API and routing](docs/api.md) を参照してください。

| プロバイダー     | ルート名                 | 主な認証設定                            |
| ---------------- | ------------------------ | --------------------------------------- |
| Anthropic        | `anthropic`              | `ANTHROPIC_API_KEY`                     |
| Amazon Bedrock   | `aws-bedrock`            | `AWS_BEARER_TOKEN_BEDROCK`              |
| Azure OpenAI     | `azure-openai`           | `AZURE_OPENAI_API_KEY`                  |
| Cerebras         | `cerebras`               | `CEREBRAS_API_KEY`                      |
| Cline            | `cline`                  | `CLINE_API_KEY`                         |
| Cohere           | `cohere`                 | `COHERE_API_KEY`                        |
| DeepSeek         | `deepseek`               | `DEEPSEEK_API_KEY`                      |
| Google AI Studio | `google-ai-studio`       | `GEMINI_API_KEY`                        |
| Google Vertex AI | `google-vertex-ai`       | `GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON` |
| Grok (xAI)       | `grok`                   | `GROK_API_KEY`                          |
| Groq             | `groq`                   | `GROQ_API_KEY`                          |
| Hugging Face     | `huggingface`            | `HUGGINGFACE_API_KEY`                   |
| Mistral          | `mistral`                | `MISTRAL_API_KEY`                       |
| NVIDIA NIM       | `nvidia-nim`             | `NVIDIA_NIM_API_KEY`                    |
| Ollama           | `ollama`                 | `OLLAMA_API_KEY`                        |
| OpenAI           | `openai`                 | `OPENAI_API_KEY`                        |
| OpenRouter       | `openrouter`             | `OPENROUTER_API_KEY`                    |
| Perplexity       | `perplexity-ai`          | `PERPLEXITYAI_API_KEY`                  |
| Replicate        | `replicate`              | `REPLICATE_API_KEY`                     |
| Workers AI       | `workers-ai`             | `CLOUDFLARE_API_KEY` とアカウント ID    |
| カスタム         | 設定したエンドポイント名 | 設定した `apiKeys`                      |

クラウドプラットフォーム系のプロバイダーには追加設定が必要です。Vertex AI は認証済みの
AI Gateway 経由でのみ利用できます。要件と設定値の形式は
[Configuration reference](docs/configuration.md) を参照してください。

## クイックスタート

Node.js 22.12 以降、npm、Cloudflare アカウント、1つ以上のプロバイダー認証情報が必要です。

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers.git
cd llm-proxy-on-cloudflare-workers
npm ci
npm run cf:login
npm run secrets:create
npm run deploy
npm run secrets:deploy
```

`npm run secrets:create` は Git 対象外の `config.jsonc` を作成します。デプロイ前に、十分に
長く一意な `PROXY_API_KEY` と、1つ以上のプロバイダー認証情報を設定してください。
`config.example.jsonc` をコピーして手動で編集することもできます。

検証手順、名前付き環境、セキュリティ上の注意点は
[初期セットアップ](docs/initial-setup_ja.md) に記載しています。

## 使用例

OpenAI 互換エンドポイントでは、プロバイダー名を含むモデル ID を指定します。

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.6-sol",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

`POST /v1/responses` は実験的な互換機能です。Responses リクエストを内部で Chat
Completions 形式に変換し、プロバイダーからの JSON または SSE を Responses 形式へ
戻します。プロバイダー固有の Responses API へのパススルーではなく、対応する入力、
ツール、ストリーミング機能には制限があります。詳細は
[HTTP API and routing](docs/api.md#responses) を参照してください。

`POST /v1/messages` も実験的な互換機能です。Anthropic Messages の対応範囲を Chat
Completions に変換し、プロバイダーの JSON または SSE を Anthropic 形式へ戻します。
プロバイダー、virtual model、認証情報、AI Gateway の経路は Chat Completions と共通です。
Anthropic 固有機能をそのまま使う場合は `/anthropic/v1/messages` を使用してください。
詳細は [HTTP API and routing](docs/api.md#messages) を参照してください。

プロバイダー固有のリクエストは、パススルールートへそのまま送信できます。

```bash
curl https://your-worker.example/google-ai-studio/v1beta/models/gemini-3.5-flash:generateContent \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "contents": [{"role": "user", "parts": [{"text": "Hello"}]}]
  }'
```

`CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を設定すると、AI Gateway の
4つのアカウントレベル REST ルートを `/ai` 以下で利用できます。設定済みまたは暗黙の
`default` 以外の Gateway を選ぶ場合は `/g/<gateway>` を先頭に付けます。

`GET /v1/models` は、設定済みプロバイダーのモデル一覧をベストエフォートで集約します。
`GET /status` は認証情報を検査しますが、設定メタデータと認証情報スロット数を含むため、
出力を公開しないでください。

Workers Free plan では 1 invocation あたりの subrequest が 50 件に制限されるため、
多数の provider を登録すると `/v1/models` や `/status` が失敗する可能性があります。
その場合は Workers Paid plan を検討してください。詳細は
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests)
を参照してください。

プロバイダー認証情報の設定では、プロファイル名ごとのキー配列も指定できます。指定を
省略したルートは `default` を使います。たとえば OpenAI の `second` プロファイルは
`openai:second/gpt-5.6-sol` で選択できます。詳細は
[Configuration reference](docs/configuration.md#provider-credential-profiles) を参照してください。

## ドキュメント

- [初期セットアップ](docs/initial-setup_ja.md) ([English](docs/initial-setup.md))
- [Configuration reference](docs/configuration.md)
- [HTTP API and routing](docs/api.md)
- [Operations and troubleshooting](docs/operations.md)
- [Development and verification](docs/development.md)
- [Architecture and design](docs/design/overview.md)
- [Project principles](docs/project-principles.md)
