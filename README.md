# LLM Proxy on Cloudflare Workers

This is a serverless proxy built on [Cloudflare Workers](https://www.cloudflare.com/developer-platform/products/workers/) that integrates with multiple Large Language Model (LLM) APIs. Inspired by [LiteLLM](https://github.com/BerriAI/litellm).

## Features

- **Centralized API Key Management:** Manage all your LLM API keys in one place.
- **Pass-through Endpoints:** Forward requests directly to any LLM API with minimal changes.
  - Examples: `/openai/chat/completions`, `/google-ai-studio/v1beta/models/gemini-1.5-pro:generateContent`
- **OpenAI-Compatible Endpoints:** Use standard OpenAI endpoints for seamless integration with existing tools and libraries.
  - `/v1/chat/completions`
  - `/v1/models`
- **Cloudflare AI Gateway Integration:** Leverage [Cloudflare AI Gateway](https://www.cloudflare.com/developer-platform/products/ai-gateway/), including its [Universal Endpoint](https://developers.cloudflare.com/ai-gateway/providers/universal/), for logging, analytics, and other features.

```mermaid
flowchart
  A[USER] -->　B(LLM Proxy)
  B --> C(Cloudflare AI Gateway)
  B --> D
  C --> D["LLM API (OpenAI, Google AI Studio, Anthropic ...)"]
```

## Supported Providers

| Name             | Support | Direct | AI Gateway Support | Pass-Through Routes | Environment Variable                         |
| ---------------- | ------- | ------ | ------------------ | ------------------- | -------------------------------------------- |
| OpenAI           | ✅      | ✅     | ✅                 | `openai`            | `OPENAI_API_KEY`                             |
| Google AI Studio | ✅      | ✅     | ✅                 | `google-ai-studio`  | `GEMINI_API_KEY`                             |
| Anthropic        | ⚠️      | ✅     | ✅                 | `anthropic`         | `ANTHROPIC_API_KEY`                          |
| Cerebras         | ✅      | ❌     | ✅                 | `cerebras`          | `CEREBRAS_API_KEY`                           |
| Cohere           | ✅      | ✅     | ✅                 | `cohere`            | `COHERE_API_KEY`                             |
| DeepSeek         | ✅      | ✅     | ✅                 | `deepseek`          | `DEEPSEEK_API_KEY`                           |
| Grok             | ✅      | ✅     | ✅                 | `grok`              | `GROK_API_KEY`                               |
| Groq             | ✅      | ✅     | ✅                 | `groq`              | `GROQ_API_KEY`                               |
| Mistral          | ✅      | ✅     | ✅                 | `mistral`           | `MISTRAL_API_KEY`                            |
| Perplexity       | ❌      | ❌     | ❌                 | `perplexity`        |                                              |
| Azure OpenAI     | ❌      | ❌     | ❌                 | `azure-openai`      |                                              |
| Vertex AI        | ❌      | ❌     | ❌                 | `google-vertex-ai`  |                                              |
| Amazon Bedrock   | ❌      | ❌     | ❌                 | `aws-bedrock`       |                                              |
| OpenRouter       | ✅      | ✅     | ✅                 | `openrouter`        | `OPENROUTER_API_KEY`                         |
| Workers AI       | ✅      | ✅     | ✅                 | `workers-ai`        | `CLOUDFLARE_ACCOUNT_ID` `CLOUDFLARE_API_KEY` |
| HuggingFace      | ⚠️      | ✅     | ✅                 | `huggingface`       | `HUGGINGFACE_API_KEY`                        |
| Replicate        | ❌      | ❌     | ❌                 | `replicate`         |                                              |

**Note**: Providers marked with ⚠️ have limited support for certain features (e.g., Tool Use, multimodal capabilities).

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js:** Version `18.x` or later is required.
  - Download from: [nodejs.org](https://nodejs.org/)
  - Verify your version: Run `node -v` in your terminal.
- **Cloudflare Account:** A Free Plan is probably sufficient to deploy this project.
  - Sign up for free at: [cloudflare.com](https://www.cloudflare.com/)

## Quick Start

To get started:

1. Clone this repository.
2. Deploy the Cloudflare Worker: `npx wrangler deploy`
3. Set environment variables securely using `npx wrangler secret put <ENVIRONMENT_VARIABLE_NAME>`.
   - Examples: `npx wrangler secret put PROXY_API_KEY`, `npx wrangler secret put OPENAI_API_KEY`
   - Refer to the "Environment Variables" section for a list of required variables.

## Environment Variables

### Required:

- `PROXY_API_KEY`: API key to authenticate requests to the LLM Proxy server. (Any string can be used)

### Cloudflare AI Gateway (Optional)

Set these if you are using the Cloudflare AI Gateway.

- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID.
- `AI_GATEWAY_NAME`: Name of your AI Gateway.
- `CF_AIG_TOKEN`: (Optional) Authentication token for your AI Gateway.

### Provider API Keys

Set the API key(s) for each provider you intend to use. API keys can be a single string, a comma-separated string, or a JSON-formatted string array.

- `OPENAI_API_KEY`: OpenAI API key.
- `GEMINI_API_KEY`: Google AI Studio API key.
- `ANTHROPIC_API_KEY`: Anthropic API key.
- `CEREBRAS_API_KEY`: Cerebras API key.
- `COHERE_API_KEY`: Cohere API key.
- `DEEPSEEK_API_KEY`: DeepSeek API Key.
- `GROK_API_KEY`: Grok API key.
- `GROQ_API_KEY`: Groq API key.
- `MISTRAL_API_KEY`: Mistral API key.
- `OPENROUTER_API_KEY`: OpenRouter API key.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID. (for Workers AI).
- `CLOUDFLARE_API_KEY`: Cloudflare API key (for Workers AI).
- `HUGGINGFACE_API_KEY`: HuggingFace Access Tokens

### Proxy Configuration:

- `RETRY`: Number of retry attempts for failed requests to the LLM provider via AI Gateway. Defaults to 0 (no retries). Only applicable when using AI Gateway.

## Usage Example

Send requests to your deployed Cloudflare Worker URL with the appropriate route and API key.

### OpenAI-Compatible Endpoints

These endpoints are designed to be compatible with the OpenAI API.

#### cURL

```bash
curl https://your-worker-url/v1/models \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json"
```

```bash
curl -X POST https://your-worker-url/v1/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello, world!"}]
  }'
```

#### Python (OpenAI SDK)

```Python
from openai import OpenAI

client = OpenAI(
    api_key="PROXY_API_KEY",
    base_url="https://your-worker-url"
)
models = client.models.list()
for model in models.data:
    print(model.id)
```

```python
from openai import OpenAI

client = OpenAI(
    api_key="PROXY_API_KEY",
    base_url="https://your-worker-url"
)
response = client.chat.completions.create(
    model: "google-ai-studio/gemini-1.5-pro",
    messages: [{ "role": "user", "content": "Hello, world!" }],
)

print(response.choices[0].message.content)
```

### Pass-through Endpoints

Forward requests directly to the LLM provider's API using these endpoints.

#### cURL

```bash
curl -X POST https://your-worker-url/openai/chat/completions \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello, world!"}]
  }'
```

```bash
curl -X POST https://your-worker-url/google-ai-studio/v1beta/models/gemini-1.5-pro:generateContent \
  -H "Authorization: Bearer $PROXY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello, world!"}]}]
  }'
```

## Known Issues and Limitations

This project is under active development and has the following known issues and limitations:

- **Limited Testing:** The project currently lacks comprehensive test coverage. This may lead to unexpected behavior or bugs.
- **Incomplete Provider Support:** Not all LLM providers are fully supported. Some providers may have limited feature support or may not be supported at all.
- **Insufficient Validation:** Thorough validation of the behavior against different providers and inputs is not yet completed.
- **Error Handling:**: Error handling could be more robust. Some errors may not be caught or reported properly.
