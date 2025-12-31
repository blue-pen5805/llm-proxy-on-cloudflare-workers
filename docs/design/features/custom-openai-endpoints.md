# Custom OpenAI-Compatible Endpoints

## Overview

The Custom OpenAI-Compatible Endpoints feature allows users to define additional, arbitrary OpenAI-compatible API providers via the configuration file (`config.jsonc`). This enables the proxy to support self-hosted LLMs (e.g., vLLM, LocalAI) or niche providers without requiring changes to the core codebase.

## Design Rationale

Statically defining providers is insufficient for users who operate their own inference servers. By providing a dynamic configuration mechanism, the proxy becomes a truly universal LLM gateway.

## Implementation Details

### Configuration

Custom endpoints are defined in the `CUSTOM_OPENAI_ENDPOINTS` environment variable (mapped from `config.jsonc`). Each endpoint configuration includes:

- `name`: A unique identifier for the provider.
- `baseUrl`: The base URL of the API (e.g., `https://my-vllm.internal/v1`).
- `apiKeys`: (Optional) A single string or an array of strings for authentication.

### Provider Resolution

The `getProvider` and `getAllProviders` functions in `src/providers.ts` were updated to:

1. First, look for a matching static provider.
2. If not found, look for a matching `name` in `CUSTOM_OPENAI_ENDPOINTS`.
3. If a match is found, instantiate a `CustomOpenAI` provider.

### CustomOpenAI Provider

The `CustomOpenAI` class extends `OpenAICompatibleProvider` and overrides:

- `baseUrl()`: Returns the configured `baseUrl`.
- `headers()`: Implements basic `Authorization: Bearer <key>` using the configured `apiKeys` (supporting simple round-robin).
- `available()`: Always returns `true`.

### Usage

To use a custom endpoint, specify the model name as `${name}/${model_name}`.

Example:
If a custom endpoint is named `my-vllm`, a request to `my-vllm/llama-3` will be routed to the configured `baseUrl` with the model name `llama-3`.

## References

- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Cloudflare Workers Environment Variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
