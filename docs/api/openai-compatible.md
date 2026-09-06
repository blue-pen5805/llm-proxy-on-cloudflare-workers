# OpenAI-compatible API

The OpenAI-compatible API provides Chat Completions, Responses routing with an
experimental conversion fallback, and aggregated model discovery. Models use a provider-qualified
selector such as `openai/gpt-5.4`; append `:<profile>` to the provider name to
select a named credential pool, such as `openai:paid/gpt-5.4`.

## Chat Completions

`POST /v1/chat/completions` and its `/chat/completions` alias accept a JSON body
limited to 10 MiB:

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

The first model segment identifies the provider; the remaining string is sent
as the upstream model, so model IDs containing `/` are supported. `model:
"default"` uses `DEFAULT_MODEL`. Invalid JSON, a missing model, an unknown
provider, or a missing default returns HTTP 400.

A model that does not name a real provider can select an operator-defined
virtual model. Its candidates run in order under their normal provider routing
and key policies. See [Configuration](../configuration.md#virtual-models) for
the declaration format and [Virtual models design](../design/features/virtual_models.md)
for retry semantics.

Adapters retain only parameters supported by each upstream API. Translation is
OpenAI-compatible at the endpoint level, not a guarantee that every OpenAI field
or provider feature has identical semantics.

The selected provider operation is used for both direct and Gateway requests.
A declared Chat Completions API takes priority over conversion, including
Anthropic's `/v1/chat/completions` and Google AI Studio's OpenAI-compatible
endpoint. Anthropic's compatibility API uses Bearer authentication and preserves
Chat payloads; its [upstream compatibility limitations](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk)
apply. Vertex Google models and Bedrock OpenAI/Anthropic models also use matching Chat APIs; other Bedrock families use Converse.
Conversion paths have the
[bounded native conversion contract](../design/features/native_inference.md#conversion-contract).
A provider with no applicable operation or conversion returns HTTP 400 before
an upstream request.

`CHAT_RESPONSE_METADATA_ENABLED=true` adds a top-level `llm_proxy` object after
a concrete route is selected. It reports routing, credential slot, Gateway,
request ID, and timing metadata without credential material. Streaming output
adds one empty-choice metadata chunk before `[DONE]`. The feature defaults to
`false`; bodies that cannot be safely transformed remain unchanged. See the
[metadata contract](../design/features/provider_abstraction.md#compatibility-response-metadata).

When AI Gateway is selected, automatic routing uses provider-specific upstream
APIs: the provider's Chat Completions endpoint when selected, or a conversion
endpoint such as Vertex Messages/GenerateContent or Bedrock Converse. Vertex and Bedrock can select a different
protocol by model. These conversions support a defined subset; unsupported
fields return HTTP 400. Messages conversion requires `max_tokens` or
`max_completion_tokens`. Gemini and Converse image conversion accepts base64
data URLs only. See [Native inference](../design/features/native_inference.md)
for defaults, credentials, and conversion limits.

## Responses

`POST /v1/responses` and `/responses` use the upstream Responses API for
Azure OpenAI, DeepSeek, Hugging Face Inference Providers, Bedrock OpenAI models,
Perplexity Agent models, OpenAI, Groq, xAI (`grok`), OpenRouter, Ollama, Workers AI, and custom OpenAI
endpoints with `responsesPath` configured. Request fields
such as `previous_response_id`, built-in tools, and encrypted reasoning are
preserved; support for each field or model is validated upstream. Successful
JSON, SSE events, and upstream errors pass through without conversion. Only
the model selector and provider-required routing envelope are adjusted.

Azure Responses and Hugging Face inference connect directly in non-strict mode
and use Custom Providers in strict Gateway mode. Perplexity Responses requires
a provider-prefixed Agent model; unprefixed Sonar models use conversion.

Workers AI Responses requires a Gateway context and an `@cf/` model that
supports Responses.

Other providers use the experimental Chat conversion described below. Native
capability is selected per concrete model, including each virtual-model
candidate. See [Native inference](../design/features/native_inference.md).

Native Responses does not inject `llm_proxy` response metadata. The optional
metadata setting applies to Chat and converted responses. Gateway metadata and
logs remain available for every route. Stateful identifiers belong to the
upstream provider; this POST route does not add response retrieval or deletion
routes.

Both routes use the same provider selection, virtual-model fallback, credential
profiles, key rotation and cooldown, AI Gateway
routing, and cancellation behavior as Chat Completions. On conversion paths,
the provider filters Chat fields. The conversion maps
constructs with a direct Chat equivalent and ignores independently removable
fields or items that have no equivalent. It does not add proxy-owned state or
tool execution.

The compatibility contract follows the
[OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
and
[Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events),
last verified on 2026-08-14.

`POST /v1/responses` and its `/responses` alias accept an OpenAI Responses body
with the same provider-qualified model selector as Chat Completions:

```bash
curl https://your-worker.example/v1/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.4",
    "instructions": "Answer concisely.",
    "input": "Why is the sky blue?",
    "stream": true
  }'
```

### Request conversion fallback

This section and the conversion limits below apply only when the selected
provider lacks a native Responses capability.

The handler reads at most 10 MiB, validates the Responses object, and constructs
a Chat Completions request with the original provider-qualified `model`.
`instructions` becomes a leading system message. A string `input` becomes a
user message. Message items retain user, assistant, or system roles; developer
messages become system messages for broader provider compatibility. Text,
image-URL, uploaded-file-ID, and base64 file parts map to Chat content parts.
Responses function and custom tool calls map to assistant tool calls; their
string outputs and text-part output arrays map to tool messages.

Function and custom tool definitions and named choices are wrapped in their
Chat Completions shapes. An `allowed_tools` choice converts each named function
or custom tool. `text.format` maps to `response_format`, `text.verbosity` to
`verbosity`, `max_output_tokens` to `max_completion_tokens`, and
`reasoning.effort` to `reasoning_effort`. Compatible sampling, metadata, user,
service-tier, moderation, prompt-cache, safety-identifier, log-probability, and
parallel-tool fields retain their values. Prompt-cache breakpoints on supported
text, image, and file parts are retained.

Responses `stream_options` are merged with the forced Chat `include_usage`
option. An `include` entry for `message.output_text.logprobs` enables Chat
`logprobs`; other inclusion entries remain ignored. If filtering unsupported
tools leaves an `allowed_tools` choice empty, both the empty tool list and
choice are omitted. Other members of the `reasoning` object, including
`summary` and `context`, are ignored because Chat Completions has no equivalent.
This lets clients send future reasoning options without breaking the bounded
conversion; the response still reports only the behavior that actually ran.
Streaming requests force `stream_options.include_usage` so the final Responses
event can carry usage when the selected provider supports it.

The converted object and sanitized headers are passed directly to the Chat
Completions handler without serializing an intermediate request or parsing the
converted JSON a second time. Consequently, Responses accepts the same real
providers, named credential profiles, `default`, virtual models, explicit key
selection, and Gateway selection as Chat Completions. Each provider filters
the resulting Chat fields according to its declared capability.

### Response conversion

A successful object-valued Chat Completions response is parsed up to 5 MiB. The
first choice becomes a completed Responses message item; Chat function and
custom tool calls become separate `function_call` and `custom_tool_call` output
items. Chat token log probabilities are converted to the Responses output-text
shape. Prompt, completion, cached, and reasoning token counts are renamed to
the Responses usage shape. A `length` finish reason produces `status:
"incomplete"`; other finish reasons produce `completed`. Non-successful
upstream responses retain their status and error body.

When `CHAT_RESPONSE_METADATA_ENABLED=true`, the `llm_proxy` object produced by
the selected Chat route is retained on the converted Responses object. In a
stream it appears on the final `response.completed` or `response.incomplete`
event's `response`, preserving the concrete provider, model, credential slot,
Gateway route, request ID, and timing metadata without adding a Chat chunk to
the client-visible Responses stream.

For `text/event-stream`, a `TransformStream` incrementally converts Chat chunks
to typed Responses events. It emits response lifecycle events, message and
content item creation, `response.output_text.delta`, function-call item
creation, `response.function_call_arguments.delta`, matching done events, and
a final `response.completed` or `response.incomplete`. Custom calls use the
matching `response.custom_tool_call_input.delta` and done events. Text delta and
done events always contain the current `logprobs` field. Terminal `error` events
put `code`, `message`, and `param` directly on the event.

Unless `include_obfuscation` is `false`, an upstream Chat obfuscation string is
moved to the first corresponding Responses text, function-argument, or
custom-tool-input delta produced from that chunk. It is consumed once per
bounded Chat record and is never duplicated across events. Multiline SSE data
is joined before parsing.

### Streaming limits and failures

The converter caps each SSE record at 1 MiB, retained text at 4 MiB, retained
tool arguments at 4 MiB, retained logprobs at 4 MiB, tool metadata at 64 KiB,
tool calls at 64, and output items at 64. These independent limits leave headroom beneath the Workers
128 MiB isolate limit while the converter retains the content required to
construct the final Responses event.

Exceeding a limit or receiving malformed SSE emits a terminal `error` event,
emits no successful terminal event, and cancels the upstream stream. Success
requires the `[DONE]` sentinel. A stream that ends without it emits a terminal
`error` event and no success event. Backpressure and downstream cancellation
otherwise propagate through the Chat request path.

The logprob budget counts serialized nonempty converted batches for both
text events and output items, including token byte arrays and alternatives.
The final event retains at most 12 MiB of generated content: up to 4 MiB of text,
4 MiB of tool arguments, and 4 MiB of logprobs, with item and metadata overhead
bounded separately.

### Ignored and unsupported conversion features

The Worker has no persistent conversation state and does not execute tools.
Top-level fields without a supported Chat Completions conversion, including
removed and unknown fields, are ignored rather than forwarded. Unsupported
members of otherwise convertible objects, built-in tools, unsupported allowed
tools, item types, and content parts are also omitted when they can be removed
independently. Compatible parts of the same request continue to be converted.
The response reports only the behavior that actually ran, such as `background:
false`, `previous_response_id: null`, and `truncation: "disabled"`.

HTTP 400 is reserved for a malformed request envelope, missing required fields,
or an invalid shape for a recognized value required to perform a safe
conversion. Function and custom tools remain supported because their execution
stays with the client, matching Chat Completions semantics. Callers that require
ignored state, built-in-tool, or provider-native semantics must use a native
Responses endpoint or a separate stateful service.

### References

- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Migrating to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)

## Models

`GET /v1/models` and its `/models` alias query configured providers and prefix
each returned ID with its route selector. Default-profile IDs use
`<provider>/<model>` and named-profile IDs use
`<provider>:<profile>/<model>`. `GET /v1/models/<model>` selects an exact
provider-qualified or virtual model ID from the same aggregate and returns
`model_not_found` when absent.

When `VIRTUAL_MODELS` is configured, every virtual model is listed first with
`owned_by: "virtual"`. All configured providers are queried concurrently, each
with a 60-second timeout and 1 MiB response limit. At most 1,000 models per
provider and 4 MiB of serialized model entries are retained. A bounded
aggregate includes `X-Proxy-Models-Truncated: true` when it is truncated.
Non-successful upstream responses are discarded before provider-specific model
conversion. Provider enumeration and fetch failures are logged and omitted, so a
successful response may be partial. A provider's retained batch is also omitted
if any entry is not an object with a non-empty string ID. Exceeding either
retention limit marks the aggregate as truncated; a provider's count limit
does not suppress later providers.

`?provider=openai,anthropic` restricts aggregation to the named registered
providers. After trimming and de-duplication, at most 32 names are accepted.
The normalized provider set is part of the cache key. Unknown or empty names,
more than one `provider` query parameter, or more than 32 names after
de-duplication return HTTP 400. Repeated names in one comma-separated value
are de-duplicated rather than rejected.

Successful complete aggregates are cached for `MODELS_CACHE_TTL_SECONDS`
(default 300; `0` disables caching) per Gateway and key selection, and served
with `X-Proxy-Models-Cache: HIT` or `MISS`. Partial or truncated aggregates are
served but never cached. `Cache-Control: no-cache` skips the cached copy and
refreshes it. `Cache-Control: no-store` or any `cf-aig-*` request header bypasses
the cache entirely, and bypassed responses carry no cache header.

The cache is per Cloudflare datacenter, so a configuration change can serve a
stale list from an already-primed datacenter for up to the TTL. Cache API
`open`, `match`, and `put` are optional optimizations: if an operation fails,
the request continues with an uncached provider fan-out. The cache is
ineffective on a `*.workers.dev` deployment; use a custom domain to enable it.
Client-facing model responses always carry `Cache-Control: private, no-store`;
the public max-age used by the internal Cache API is never exposed.

Custom endpoints should use a static `models` list when reliable discovery
matters. Model discovery uses the first provider key by default. If that
request returns HTTP 429, the proxy retries sequential later keys, up to three
attempts or the configured key count, without advancing striped rotation.
Other statuses do not rotate, and an explicit `/key/<selection>` prefix
disables the retry. Bedrock and Azure OpenAI are omitted unless their required
local credentials and routing settings are configured, including in strict
Gateway mode.
