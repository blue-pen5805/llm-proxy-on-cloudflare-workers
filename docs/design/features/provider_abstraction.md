# Provider Abstraction & Compatibility Design

## Core Objective
The system is designed to act as a **Universal Translator** for LLMs. It exposes a standardized interface (OpenAI compatibility) while hiding the proprietary details of various upstream providers.

## Design Pattern: Adapter Pattern
We utilize the **Adapter Pattern** to normalize communication with different LLM backends.

### Component Structure
*   **`ProviderBase`**: A common interface and base class that defines the core contract for all providers, including request building (`buildChatCompletionsRequest`) and response fetching.
*   **Concrete Adapters**: Specialized classes (e.g., `Anthropic`, `GoogleAiStudio`, `WorkersAi`) that implement provider-specific logic.

## OpenAI Compatibility Layer
The proxy serves as a drop-in replacement for OpenAI API calls.

### Feature Mapping
*   **Chat Completions**: The proxy listens on standard `/v1/chat/completions`. It parses the `model` field to determine the target provider (e.g., `anthropic/claude-3-opus-20240229`).
*   **Model Aggregation**: The `GET /v1/models` endpoint aggregates models from all configured and available providers.

## Routing Strategy
1.  **Direct Provider Proxying**: Paths starting with `/{provider}/` bypass the default provider logic.
2.  **Implicit Routing**: Standard endpoints (like `/v1/chat/completions`) use the provider prefix in the `model` string.

## References
*   [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
*   [Anthropic API Reference](https://docs.anthropic.com/en/api/reference)
*   [Google Gemini API Reference](https://ai.google.dev/api)
*   [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
