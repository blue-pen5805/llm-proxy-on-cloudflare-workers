# Native Inference Endpoint Selection

## Boundary and selection

Public inference routes prefer the corresponding upstream API when the provider
declares it for the selected model. Provider-hosted compatibility APIs count as
a match: `/v1/chat/completions` and `/chat/completions` select the provider's
Chat Completions operation even when it also has a proprietary API. Conversion
defaults are considered only when no matching operation exists.
OpenAI Chat requests use Chat Completions, OpenAI Responses requests
use Responses, and Anthropic Messages requests use Messages. Automatic AI
Gateway routing uses provider endpoints, not Unified `/compat/chat/completions`.
Explicit provider pass-through, `/compat/chat/completions`, and `/ai/...` routes
retain their own contracts.

`ProviderDefinition.endpoints` groups executable `chat_completions`, `responses`,
`messages`, and `models` operations. A declared inference operation consumes that
public protocol. `resolveEndpoint(model, protocol)` can override it: `undefined`
retains the declaration and `null` disables same-protocol support for that model.
An undeclared operation does not acquire a default path.

`resolveInference(model, protocol)` resolves each concrete virtual-model
candidate once. It selects the matching public operation first. Otherwise it
uses `resolveChatFallback(model)`, then `chatFallback`, then the declared Chat
operation. It returns the selected operation and whether request conversion is
needed. With no supported route, inference returns HTTP 400 without a fetch.

Same-protocol routing preserves request fields, with only model-selector,
declared Chat filtering, and provider-envelope adjustments. Successful and error
responses, including SSE, pass through unless the operation explicitly
transforms them. Native Responses and Messages do not inject optional Chat
response metadata. Gateway metadata and lifecycle logs still identify the route
and selected credential.

Without a matching public operation, Responses and Messages lazily convert to
Chat Completions. A `convertedChatEndpoint` applies its `ChatConversionCodec` to
that Chat payload and converts the upstream result back to Chat. The public
route then converts the result to the requested protocol. The same selected
operation runs for direct and Gateway requests; upstream errors do not trigger
a retry through a different protocol.

An `InferenceEndpoint` owns `buildRequest` and optional `transformResponse`.
`jsonEndpoint` centralizes JSON serialization and path-specific authentication.
It returns an authenticated absolute URL for direct requests, a native Gateway
path for provider integrations, or a provider-relative path for Custom Gateway
routing. The transport sends this prepared request without rebuilding headers.
`chatCompletionsEndpoint` adds parameter filtering; its default filter is shared,
while narrowed parameter sets are compiled once with the operation.

Provider-specific `prepareGateway` hooks describe native Gateway API differences,
such as Azure deployment URLs and Vertex credential-specific project paths.
Conversion codecs omit the provider's optional Chat compatibility path prefix. Cline's response unwrapping belongs to its Chat operation.
Adding a protocol requires a corresponding operation and routing tests, or
complete codecs when wire formats differ. Custom OpenAI configuration can declare native Responses and Messages paths;
model-specific protocol selection remains a provider hook. There is no built-in
Interactions codec.

## Same-protocol capabilities

| Public API       | Providers with an explicit native capability                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions | Anthropic, OpenAI, Azure OpenAI, Cerebras, Cline, Cohere, DeepSeek, Google AI Studio, Google Vertex AI (Google models), Hugging Face Inference Providers, Groq, xAI (`grok`), Mistral, NVIDIA NIM, OpenRouter, Ollama, Perplexity, Workers AI, custom OpenAI endpoints; Bedrock for `openai.*` and `anthropic.*` model families |
| Responses        | Azure OpenAI, DeepSeek, Hugging Face Inference Providers, Bedrock OpenAI models, Perplexity Agent models, OpenAI, Groq, xAI (`grok`), OpenRouter, Ollama, Workers AI, custom endpoints with `responsesPath`                                                                                                                     |
| Messages         | Anthropic, DeepSeek, Hugging Face Inference Providers, Bedrock Anthropic models, OpenRouter, Vertex AI models selected as `anthropic/<model>`, custom endpoints with `messagesPath`                                                                                                                                             |

Responses paths are declared per provider. OpenRouter
Messages uses `/v1/messages` relative to `https://openrouter.ai/api`.
Ollama's native Responses route uses its Custom Provider in strict Gateway
mode. Workers AI Responses uses account REST `/ai/v1/responses`, requires an
`@cf/` model ID and a Gateway context, and remains subject to the model's
Responses support. Without a selected Gateway it returns HTTP 503 before a
fetch, because this account REST transport requires `cf-aig-gateway-id`. Workers
AI has no native Messages capability. Other adapters use conversion unless
they explicitly declare a matching endpoint; registering a provider does not
imply support for every API.

Anthropic Chat uses its OpenAI SDK compatibility endpoint `/v1/chat/completions`
with Bearer authentication. Anthropic Messages uses `/v1/messages` with
`x-api-key`. Responses has no declared matching Anthropic operation and uses
the Messages conversion fallback. Compatibility limitations, including ignored
fields and unavailable prompt caching, belong to Anthropic's upstream API.

These capabilities follow [Anthropic OpenAI SDK compatibility](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk),
[Cloudflare OpenAI routing](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/),
[Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai),
[Groq's API reference](https://console.groq.com/docs/api-reference),
[xAI Responses](https://docs.x.ai/developers/model-capabilities/text/comparison),
[OpenRouter Responses](https://openrouter.ai/docs/api/api-reference/responses/create-responses),
[OpenRouter Messages](https://openrouter.ai/docs/api/api-reference/anthropic-messages/create-messages),
[Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), and
[Cloudflare account REST capabilities](https://developers.cloudflare.com/ai-gateway/usage/rest-api/).

## Provider API boundaries

DeepSeek uses `/responses` and `/anthropic/v1/messages`; Messages authentication
uses `x-api-key`, while Chat and Responses use Bearer authentication. Native
fields and upstream model mapping remain under DeepSeek's control. See
[Responses](https://api-docs.deepseek.com/guides/responses_api/) and
[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/).

Vertex Google Chat uses the selected service account's project and region with
`/v1/projects/<project>/locations/<region>/endpoints/openapi/chat/completions`.
Bare model IDs gain the required `google/` publisher prefix; existing publisher
prefixes are preserved. Other publishers require an explicit adapter. Responses
still uses GenerateContent conversion for Google models. See
[Vertex OpenAI compatibility](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview).

Bedrock OpenAI models use `/openai/v1/chat/completions` and
`/openai/v1/responses`. Anthropic models use `/v1/chat/completions` and
`/anthropic/v1/messages`; Messages uses `x-api-key` and defaults
`anthropic-version` to `2023-06-01`. Family recognition accepts optional `us.`,
`us-gov.`, `eu.`, `apac.`, and `global.` profile prefixes without changing them.
Regional availability and individual model/API compatibility are enforced
upstream. Other families retain Converse conversion. See
[Bedrock Chat](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html),
[Responses](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html),
and [Messages](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-messages-api.html).

Perplexity models containing a provider prefix (`provider/model`) use Agent
`/v1/responses` for Responses and `/v1/chat/completions` for Gateway Chat.
Unprefixed Sonar models retain Chat conversion for Responses and the Gateway
`/chat/completions` path. See
[Perplexity compatibility](https://docs.perplexity.ai/docs/agent-api/openai-compatibility).

Azure Responses uses `/openai/v1/responses`. Its operation disables native
Gateway routing: non-strict mode connects directly, and strict mode uses the
Azure Custom Provider also used for model discovery. The native Gateway Azure
integration documents deployment-specific Chat URLs, not the v1 Responses
route. See [Azure Responses](https://learn.microsoft.com/en-us/rest/api/aifoundry/azureopenai/responses)
and [Cloudflare Azure routing](https://developers.cloudflare.com/ai-gateway/usage/providers/azureopenai/).

Hugging Face inference uses `https://router.huggingface.co` with
`/v1/chat/completions`, `/v1/responses`, and `/v1/messages` and the selected
Hugging Face token as Bearer authorization. Model IDs and provider-selection
suffixes remain opaque. Pass-through retains its independent
`https://api-inference.huggingface.co/models` origin. Inference connects directly
in non-strict mode; strict mode uses the separately synchronized Custom Provider
named `huggingface/inference`. It does not use Cloudflare's native Hugging Face
integration, which documents the model-inference origin. See
[Chat](https://huggingface.co/docs/inference-providers/en/tasks/chat-completion),
[Responses (beta)](https://huggingface.co/docs/inference-providers/en/guides/responses-api),
[Messages integration](https://huggingface.co/docs/inference-providers/en/integrations/claude-code),
and [Cloudflare Hugging Face routing](https://developers.cloudflare.com/ai-gateway/usage/providers/huggingface/).

Cerebras, Cline, Cohere, Google AI Studio, and Mistral declare Chat; their
reviewed API references do not establish additional matching Responses or
Messages operations for these adapters. Replicate's Predictions API is not a
matching Chat, Responses, or Messages API. NVIDIA NIM's self-hosted API and
Ollama's local Anthropic API do not establish Messages support at the built-in
hosted origins. xAI's Anthropic compatibility is fully deprecated and is not
selected automatically. See [Cerebras](https://inference-docs.cerebras.ai/api-reference/chat-completions),
[Cline](https://docs.cline.bot/api/chat-completions),
[Cohere](https://docs.cohere.com/docs/compatibility-api),
[Mistral](https://docs.mistral.ai/api),
[Replicate](https://replicate.com/docs/reference/http),
[NVIDIA hosted API](https://docs.api.nvidia.com/nim/reference),
[Ollama Anthropic compatibility](https://docs.ollama.com/api/anthropic-compatibility),
and [xAI deprecation](https://docs.x.ai/developers/rest-api-reference/inference/legacy).

## Conversion and transport paths

These defaults apply when no matching public-protocol capability is selected.
The table shows native Gateway paths; direct requests use the same operation
against the provider origin. Anthropic uses `/v1/messages`. Bedrock uses
`/model/<model>/converse` or `/openai/v1/chat/completions` for its OpenAI models;
its `/bedrock-runtime/<region>` prefix is Gateway-specific. Vertex remains
Gateway-only. Azure uses `/openai/v1/chat/completions` directly and its deployment
API through Gateway. Perplexity uses `/v1/chat/completions` directly and
`/chat/completions` through Gateway. Model and routing identifiers are URL-encoded;
empty Bedrock model IDs and the dot segments `.` and `..` are rejected before a
fetch.

| Provider                  | Default endpoint                                                                             | Model-specific selection                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic                 | `/v1/messages`                                                                               | None                                                                                                                                           |
| Google AI Studio          | `/v1beta/models/<model>:generateContent`                                                     | None                                                                                                                                           |
| Google Vertex AI          | `/v1/projects/<project>/locations/<region>/publishers/google/models/<model>:generateContent` | `anthropic/<model>` uses the Anthropic publisher's `:rawPredict` Messages endpoint                                                             |
| Amazon Bedrock            | `/bedrock-runtime/<region>/model/<model>/converse`                                           | `openai.*`, optionally prefixed by `us.`, `us-gov.`, `eu.`, `apac.`, or `global.`, uses `/bedrock-runtime/<region>/openai/v1/chat/completions` |
| Azure OpenAI              | Resource/deployment-specific `/chat/completions`                                             | Resource and deployment routing                                                                                                                |
| Perplexity                | `/chat/completions`                                                                          | None                                                                                                                                           |
| Workers AI                | Account REST `/ai/v1/chat/completions`                                                       | Only Workers AI `@cf/` model IDs are accepted                                                                                                  |
| Other supported providers | Provider-defined Chat Completions path                                                       | None                                                                                                                                           |

Streaming uses `:streamGenerateContent?alt=sse`, Vertex Anthropic
`:streamRawPredict`, or Bedrock `/converse-stream` as appropriate. Vertex accepts
bare Google model IDs or `google/<model>`; other publisher prefixes are rejected
unless an explicit resolver supports them. Vertex Anthropic requests carry
`anthropic_version: vertex-2023-10-16` and select the model through the URL.

Provider-native endpoints and paths follow the official
[Cloudflare provider documentation](https://developers.cloudflare.com/ai-gateway/usage/providers/),
[Bedrock Chat Completions](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html),
[Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html),
and [Vertex Claude API](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/claude/use-claude).

## Credentials and attempts

Each attempted credential builds its path, authentication, and metadata once.
The operation is retained across attempts; selecting another key does not
resolve the protocol again.
Vertex project and region come from that slot's service-account JSON. Anthropic
uses Bearer authentication for Chat Completions and `x-api-key` for Messages
and model listing. Google AI Studio uses Bearer authentication for its Chat
compatibility API and `x-goog-api-key` for other operations; absent local keys
are omitted so Gateway BYOK can apply where the adapter supports it.

Workers AI uses account REST
`https://api.cloudflare.com/client/v4/accounts/<account>/ai/v1/chat/completions`
or `/ai/v1/responses` according to the public API
with the selected `CLOUDFLARE_API_KEY` as Bearer authorization and the selected
Gateway in `cf-aig-gateway-id`. This transport removes `cf-aig-authorization`.
A missing provider key returns HTTP 503; the separate `CLOUDFLARE_API_TOKEN`
used by explicit account REST routes does not substitute for it. This follows
[Workers AI through AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/).

Native Gateway key fallback allows at most four attempts and prepares each request
only when attempted. Network errors and HTTP 401, 403, or 429 permit another
credential. Conversion errors stop before a fetch; an explicit key selection
permits one attempt. Direct and Custom Provider routes use one credential
attempt. Provider availability, strict Custom Provider routing,
virtual-model fallback, and cooldown retain their shared policies.

## Conversion contract

The following limits apply only when translating between protocols. Native
Responses and Messages preserve provider fields and rely on upstream semantic
validation after the proxy validates the JSON object and model selector.

Native codecs intentionally cover a bounded Chat subset. Provider parameter
filtering runs first; remaining unmapped top-level fields return HTTP 400.
Provider pass-through is the route for native features outside this subset.

- Text, system/developer instructions, function tools, calls, and results map
  to the corresponding native structures. System blocks preserve their order
  through iterative accumulation within the request byte limit. Gemini tool results require a
  preceding call, and tool-call thought signatures round-trip through
  `extra_content.google.thought_signature`.
- Images accept PNG, JPEG, WebP, and GIF base64 data URLs. Messages also accepts
  HTTP(S) image URLs. Gemini and Converse reject remote URLs; the Worker never
  fetches image content during conversion. Actual model image support remains
  an upstream constraint.
- Token limits, temperature, top-p, and stop sequences map to native controls.
  `max_completion_tokens` takes precedence over `max_tokens`. Messages requires
  one of these limits. Multiple candidates are supported only by GenerateContent.
- Function tool choice maps where supported. Converse rejects `none`.
  `parallel_tool_calls: false` is supported only by Messages.
- JSON Schema output maps to each protocol's structured-output field. Plain
  `json_object` mode is supported only by GenerateContent. Schema and model
  capabilities remain subject to upstream validation.
- Successful responses map text, tool calls, finish reasons, and token usage to
  Chat Completions. Reasoning text is omitted; available reasoning and cache
  usage counts are retained. Stream usage is emitted only when
  `stream_options.include_usage` is true.

These mappings follow [Anthropic Messages](https://platform.claude.com/docs/en/api/http/messages),
[Gemini GenerateContent](https://ai.google.dev/api/generate-content), and
[Bedrock ConverseStream](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html).
Gemini signature handling follows its
[thought signature contract](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures).

## Bounds and failures

JSON conversion reads at most 5 MiB and returns HTTP 502 for malformed or
oversized successful native responses. Non-successful upstream responses pass
through without conversion. Rewritten bodies remove stale representation
headers.

Streaming conversion retains bounded frame and index state, without collecting
full generated text or tool arguments. Frames are limited to 1 MiB, with at
most 64 tool indexes and 64 candidate indexes. Bedrock binary frames validate
both CRCs according to the
[AWS event stream format](https://smithy.io/2.0/aws/amazon-eventstream.html).
Malformed, truncated, or upstream error streams fail the output stream;
cancellation propagates to the upstream reader. Valid terminal events are
required before successful completion and the Chat `[DONE]` marker.
