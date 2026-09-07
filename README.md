# LLM Proxy on Cloudflare Workers

English | [日本語](README_ja.md)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers)

A serverless proxy that provides one authenticated entry point for multiple LLM
APIs on [Cloudflare Workers](https://developers.cloudflare.com/workers/).

## Features

- OpenAI-compatible `POST /v1/chat/completions` and `GET /v1/models`
- Experimental `POST /v1/responses`, converted internally through Chat Completions
- Experimental Anthropic-compatible `POST /v1/messages`, converted through Chat Completions
- Provider pass-through routes such as `/openai/responses`
- Cloudflare AI Gateway provider routes and account-level REST API
- Multiple provider keys with striped per-isolate round-robin selection
- Named provider credential profiles selected as `provider:profile`
- Per-request key selection with `/key/<index-or-range>`
- Custom OpenAI-compatible endpoints defined in configuration
- Authenticated status and provider credential diagnostics at `/status`

## Supported providers

The route name is also the prefix used in model IDs, for example
`openai/gpt-5.6-sol`. Provider adapters differ in chat translation, model discovery,
direct access, and AI Gateway support; see [HTTP API and routing](docs/api.md)
before relying on a specific combination.

| Provider         | Route                    | Primary credential setting              |
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
| OpenCode Go      | `opencode-go`            | `OPENCODE_API_KEY`                      |
| OpenCode Zen     | `opencode-zen`           | `OPENCODE_API_KEY`                      |
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
npm run secrets
npm run deploy
npm run secrets:deploy
```

`npm run secrets` opens a terminal UI that creates or edits the ignored
`config.jsonc`, with credential values hidden. It obtains the default
Cloudflare Account ID from `wrangler whoami --json`; you can select another
reported account or overwrite the value manually. Set a strong, unique
`PROXY_API_KEY` and at least one provider credential before deploying. You can
instead copy and edit `config.example.jsonc`.

For verification steps, named environments, and security notes, follow the
[initial setup guide](docs/initial-setup.md).

## Usage

Use a provider-qualified model with the OpenAI-compatible endpoint:

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.6-sol",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

`POST /v1/responses` is an experimental compatibility feature. It converts
Responses requests to Chat Completions internally and converts provider JSON or
SSE back to Responses format. It is not a pass-through to a provider-native
Responses endpoint, and its supported inputs, tools, and streaming behavior are
intentionally bounded. See the
[OpenAI-compatible API guide](docs/api/openai-compatible.md#responses).

`POST /v1/messages` is likewise experimental. It accepts an Anthropic Messages
subset and converts provider JSON or SSE back to Anthropic message events while
reusing the same providers, virtual models, credentials, and AI Gateway routing.
Use `/anthropic/v1/messages` instead for native Anthropic pass-through. See
[Anthropic-compatible API guide](docs/api/anthropic-compatible.md#messages).

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

Workers Free limits each invocation to 50 subrequests, so `/v1/models` and
`/status` may fail when many providers are configured. Consider Workers Paid in
that case. See
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests).

Provider credential settings may also map profile names to key arrays. The
unqualified route uses `default`; for example, configure an OpenAI `second`
profile and request `openai:second/gpt-5.6-sol`. See the
[configuration reference](docs/configuration.md#provider-credential-profiles).

## Documentation

- [Initial setup](docs/initial-setup.md) ([日本語](docs/initial-setup_ja.md))
- [Configuration reference](docs/configuration.md)
- [HTTP API and routing](docs/api.md)
  - [OpenAI-compatible API](docs/api/openai-compatible.md)
  - [Anthropic-compatible API](docs/api/anthropic-compatible.md)
  - [Provider pass-through API](docs/api/provider-pass-through.md)
  - [AI Gateway API](docs/api/ai-gateway.md)
  - [Proxy management API](docs/api/proxy-management.md)
- [Operations and troubleshooting](docs/operations.md)
- [Live provider Chat Completions testing](docs/live-provider-testing.md)
- [Development and verification](docs/development.md)
- [Architecture and design](docs/design/overview.md)
- [Project principles](docs/project-principles.md)
