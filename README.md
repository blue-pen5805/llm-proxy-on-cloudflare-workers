# LLM Proxy on Cloudflare Workers

English | [日本語](README_ja.md)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers)

A serverless proxy that provides one authenticated entry point for multiple LLM
APIs on [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Features

- OpenAI-compatible `POST /v1/chat/completions` and `GET /v1/models`
- Provider pass-through routes such as `/openai/v1/responses`
- Cloudflare AI Gateway provider routes and account-level REST API
- Multiple provider keys with random or Durable Object-backed round-robin selection
- Per-request key selection with `/key/<index-or-range>`
- Custom OpenAI-compatible endpoints defined in configuration
- Authenticated status and provider credential diagnostics at `/status`

## Supported providers

The route name is also the prefix used in model IDs, for example
`openai/gpt-5.4`. Provider adapters differ in chat translation, model discovery,
direct access, and AI Gateway support; see [HTTP API and routing](docs/api.md)
before relying on a specific combination.

| Provider         | Route                    | Primary credential setting              |
| ---------------- | ------------------------ | --------------------------------------- |
| Anthropic        | `anthropic`              | `ANTHROPIC_API_KEY`                     |
| Amazon Bedrock   | `aws-bedrock`            | `AWS_BEARER_TOKEN_BEDROCK`              |
| Azure OpenAI     | `azure-openai`           | `AZURE_OPENAI_API_KEY`                  |
| Cerebras         | `cerebras`               | `CEREBRAS_API_KEY`                      |
| Cohere           | `cohere`                 | `COHERE_API_KEY`                        |
| DeepSeek         | `deepseek`               | `DEEPSEEK_API_KEY`                      |
| Google AI Studio | `google-ai-studio`       | `GEMINI_API_KEY`                        |
| Google Vertex AI | `google-vertex-ai`       | `GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON` |
| Grok (xAI)       | `grok`                   | `GROK_API_KEY`                          |
| Groq             | `groq`                   | `GROQ_API_KEY`                          |
| Hugging Face     | `huggingface`            | `HUGGINGFACE_API_KEY`                   |
| Mistral          | `mistral`                | `MISTRAL_API_KEY`                       |
| Ollama           | `ollama`                 | `OLLAMA_API_KEY`                        |
| OpenAI           | `openai`                 | `OPENAI_API_KEY`                        |
| OpenRouter       | `openrouter`             | `OPENROUTER_API_KEY`                    |
| Perplexity       | `perplexity-ai`          | `PERPLEXITYAI_API_KEY`                  |
| Replicate        | `replicate`              | `REPLICATE_API_KEY`                     |
| Workers AI       | `workers-ai`             | `CLOUDFLARE_API_KEY` and account ID     |
| Custom endpoint  | Configured endpoint name | Configured `apiKeys`                    |

Cloud-platform providers require additional settings. Vertex AI is available
only through an authenticated AI Gateway. See the
[configuration reference](docs/configuration.md) for those requirements and all
supported value formats.

## Quick start

Requires Node.js 22.12 or later, npm, a Cloudflare account, and at least one
provider credential.

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers.git
cd llm-proxy-on-cloudflare-workers
npm ci
npm run cf:login
npm run secrets:create
npm run deploy
npm run secrets:deploy
```

`npm run secrets:create` creates the ignored `config.jsonc`. Set a strong,
unique `PROXY_API_KEY` and at least one provider credential before deploying.
You can instead copy and edit `config.example.jsonc`.

For verification steps, named environments, and security notes, follow the
[initial setup guide](docs/initial-setup.md).

## Usage

Use a provider-qualified model with the OpenAI-compatible endpoint:

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.4",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Or forward a provider-native request through a pass-through route:

```bash
curl https://your-worker.example/google-ai-studio/v1beta/models/gemini-3.5-flash:generateContent \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "contents": [{"role": "user", "parts": [{"text": "Hello"}]}]
  }'
```

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to expose AI Gateway's
four account-level REST routes under `/ai`. Prefix one with `/g/<gateway>` to
select a Gateway other than the configured or implicit `default` Gateway.

`GET /v1/models` returns a best-effort aggregate of configured providers.
`GET /status` checks configured credentials but exposes configuration metadata
and credential slot counts, so keep its output private.

## Documentation

- [Initial setup](docs/initial-setup.md) ([日本語](docs/initial-setup_ja.md))
- [Configuration reference](docs/configuration.md)
- [HTTP API and routing](docs/api.md)
- [Operations and troubleshooting](docs/operations.md)
- [Development and verification](docs/development.md)
- [Architecture and design](docs/design/overview.md)
- [Second-pass adversarial review](docs/adversarial-review-round-2.md)
