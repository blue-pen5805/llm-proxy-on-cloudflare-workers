# LLM Proxy on Cloudflare Workers

English | [日本語](README_ja.md)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers)

A serverless proxy that provides one authenticated entry point for multiple LLM
APIs on [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Features

- OpenAI-compatible Chat Completions and Responses, and Anthropic-compatible Messages
- Provider-native API pass-through and aggregated model discovery
- Multiple API keys with automatic rotation, named credential pools, and per-request key selection
- Virtual models with ordered fallback across providers
- Custom OpenAI-compatible endpoints
- Cloudflare AI Gateway integration
- Authenticated provider credential diagnostics

API support varies by provider. Responses and Messages use native APIs where
available; their conversion fallbacks are experimental. See the
[API guides](docs/user/api/overview.md) for supported fields and limits.

## Supported providers

OpenAI, Anthropic, Google AI Studio, Vertex AI, Amazon Bedrock, Azure OpenAI,
Workers AI, OpenRouter, OpenCode Zen/Go, DeepSeek, Groq, xAI, Cerebras, Cline,
Cohere, Hugging Face, Mistral, NVIDIA NIM, Ollama, Perplexity, and Replicate.
See [provider configuration](docs/user/configuration.md#provider-credentials) for
route names, credentials, and additional requirements.

## Quick start

Requires Node.js 22.12 or later, npm, a Cloudflare account, and at least one
provider credential.

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers.git
cd llm-proxy-on-cloudflare-workers
npm ci
npm run cf:login
npm run secrets
npm run deploy
npm run secrets:deploy
```

In `npm run secrets`, set a strong, unique `PROXY_API_KEY` and a provider
credential. See [initial setup](docs/user/initial-setup.md) for configuration,
named environments, and deployment verification.

## Usage

Send the proxy key and a provider-qualified model ID:

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.6-sol",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Use `GET /v1/models` to discover configured models. For provider-specific
features, use a [pass-through route](docs/user/api/provider-pass-through.md).

## Documentation

- [Initial setup](docs/user/initial-setup.md) ([日本語](docs/user/initial-setup_ja.md))
- [Configuration](docs/user/configuration.md)
- [HTTP API and routing](docs/user/api/overview.md)
- [Operations and troubleshooting](docs/user/operations.md)
- [All guides and design documents](docs/index.md)
