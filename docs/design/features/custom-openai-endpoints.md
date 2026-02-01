# Custom OpenAI-Compatible Endpoints

## Overview

The Custom OpenAI-Compatible Endpoints feature allows you to define additional, arbitrary OpenAI-compatible API providers via configuration (backed by the `CUSTOM_OPENAI_ENDPOINTS` environment variable). This enables the proxy to support self-hosted LLMs (e.g., vLLM, LocalAI) or niche providers without requiring changes to the core codebase.

## Design Rationale

Statically defining providers is insufficient for users who operate their own inference servers. By providing a dynamic configuration mechanism, the proxy becomes a truly universal LLM gateway.

## Implementation Details

### Configuration

Custom endpoints are defined in the `CUSTOM_OPENAI_ENDPOINTS` environment variable (mapped from `config.jsonc`). Each endpoint configuration includes:

- `name`: A unique identifier for the provider.
- `baseUrl`: The base URL used as the upstream origin for requests (e.g., `https://my-vllm.internal/v1`).
- `apiKeys`: (Optional) A single string or an array of strings for authentication.
- `models`: (Optional) A list of model IDs to expose via `GET /v1/models` without querying the upstream.
- `chatCompletionPath`: (Optional) Overrides the upstream chat completions path (default: `/chat/completions`).
- `modelsPath`: (Optional) Overrides the upstream models path (default: `/models`).

Note: If your upstream serves OpenAI-compatible routes under `/v1`, you can either include `/v1` in `baseUrl` (and keep default paths), or keep `baseUrl` at the server root and set `chatCompletionPath`/`modelsPath` to include `/v1/...`.

### Provider Resolution

The `getProvider` and `getAllProviders` functions in `src/providers.ts` were updated to:

1. First, look for a matching static provider.
2. If not found, look for a matching `name` in `CUSTOM_OPENAI_ENDPOINTS`.
3. If a match is found, instantiate a `CustomOpenAI` provider.

### CustomOpenAI Provider

The `CustomOpenAI` class extends `OpenAICompatibleProvider` and overrides:

- `baseUrl()`: Returns the configured `baseUrl`.
- `headers()`: Implements basic `Authorization: Bearer <key>` using the appropriate API key determined by `getNextApiKeyIndex()`.
- `getNextApiKeyIndex()`: Overrides to perform stateful global round-robin rotation using the unique `name` as an identifier for coordinate through the stateful layer.
- `available()`: Always returns `true`.

### Usage

To use a custom endpoint, specify the model name as `${name}/${model_name}`.

Example:
If a custom endpoint is named `my-vllm`, a request to `my-vllm/llama-3` will be routed to the configured `baseUrl` with the model name `llama-3`.

## Model Discovery and Aggregation

### Best-effort `GET /v1/models`

The aggregated `GET /v1/models` endpoint is designed to be best-effort:

- The proxy attempts to collect models from each configured and available provider.
- Each provider model list fetch has an individual 5 second timeout.
- If a provider fails or times out, that provider's models are omitted, but the overall `GET /v1/models` response still returns models from other providers.

### Prefer Static `models` for Custom Endpoints

For custom endpoints, upstream model discovery is not always reliable (or may be slow). If you need a stable and fast `GET /v1/models`, set `models` in the custom endpoint configuration; when present, the proxy uses this list instead of calling the upstream models endpoint.

## References

- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Cloudflare Workers Environment Variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
