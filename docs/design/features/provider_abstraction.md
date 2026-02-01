# Provider Abstraction & Compatibility Design

## Core Objective

The system is designed to act as a **Universal Translator** for LLMs. It exposes a standardized interface (OpenAI compatibility) while hiding the proprietary details of various upstream providers.

## Design Pattern: Adapter Pattern

We utilize the **Adapter Pattern** to normalize communication with different LLM backends.

### Component Structure

- **`ProviderBase`**: The single foundation class for all providers. It handles both the raw communication layer (base URL, headers, fetch) and LLM-specific logic (request building, response normalization). It centralizes API key management via `getApiKeys()` and stateful rotation coordination through `getNextApiKeyIndex()`.
- **`OpenAICompatibleProvider`**: A specialized base for providers that use standard OpenAI-style headers and paths.
- **Provider Adapters**: Individual classes (e.g., `Anthropic`, `GoogleAiStudio`) that extend `ProviderBase` (or `OpenAICompatibleProvider`). This consolidated architecture eliminates redundant abstraction layers and minimizes boilerplate.

## OpenAI Compatibility Layer

The proxy serves as a drop-in replacement for OpenAI API calls.

### Feature Mapping

- **Chat Completions**: The proxy listens on standard `/v1/chat/completions`. It parses the `model` field to determine the target provider (e.g., `anthropic/claude-3-opus-20240229`).
- **Model Aggregation**: The `GET /v1/models` endpoint aggregates models from all configured and available providers. Aggregation is best-effort: each provider has an individual timeout, and providers that fail/time out are omitted so the endpoint can still return results from other providers.

## Routing Strategy

1.  **Direct Provider Proxying**: Paths starting with `/{provider}/` bypass the default provider logic.
2.  **Implicit Routing**: Standard endpoints (like `/v1/chat/completions`) use the provider prefix in the `model` string.

## Adding a New Provider

To add a new LLM provider, follow these steps:

### 1. Implement the Provider Class

Create a new directory in `src/providers/{provider-name}/` and implement the provider logic.

- **`provider.ts`**: Extend `ProviderBase` or `OpenAICompatibleProvider`. Specify `apiKeyName` and `baseUrlProp`.
- **`index.ts`**: Export the provider class and include documentation/references.
- **`types.ts` (Optional)**: Define provider-specific request/response types.

### 2. Configure Environment Variables

Follow the [add-env-var.md](../../../.agent/workflows/add-env-var.md) workflow to correctly register the new API key in the configuration schemas, example files, and type definitions.

### 3. Register the Provider

In `src/providers.ts`, import the new provider and add it to the `Providers` object. Ensure the key matches the desired URL prefix (e.g., `ollama: Ollama`).

### 4. Verification

1.  **Unit Tests**: Create tests in `test/src/providers/{provider-name}/` (follow `provider.test.ts` pattern).
2.  **Lint & Types**: Run `npm run lint` and `npm run tsc`.
3.  **E2E/Manual**: Verify the provider appears in `GET /v1/models` and responds to `/v1/chat/completions`.

## References

- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [Anthropic API Reference](https://docs.anthropic.com/en/api/reference)
- [Google Gemini API Reference](https://ai.google.dev/api)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Ollama Cloud Documentation](https://docs.ollama.com/cloud)
