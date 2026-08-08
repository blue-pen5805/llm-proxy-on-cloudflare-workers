# OpenAI-Compatible Responses API

## Purpose and boundary

This compatibility feature is experimental. Its accepted subset and converted
JSON/SSE contract are defined in this document.

The proxy exposes `POST /v1/responses` and `/responses` for clients that use the
OpenAI Responses request and response shapes while targeting providers that
offer Chat Completions. It implements a bounded compatibility conversion through
the Chat Completions handler; it does not call a provider-native
Responses endpoint.

Both routes use the same provider selection, virtual-model fallback, credential
profiles, key rotation and cooldown, provider parameter filtering, AI Gateway
routing, and cancellation behavior. The conversion is intentionally
narrow: it maps constructs with a direct Chat Completions equivalent and rejects
constructs that would require proxy-owned state or tool execution.

## Request conversion

The handler reads at most 10 MiB, validates the Responses object, and constructs
a Chat Completions request with the original provider-qualified `model`.
`instructions` becomes a leading system message. A string `input` becomes a user
message. Message items retain user, assistant, or system roles; developer
messages become system messages for broader provider compatibility. Text,
image-URL, uploaded-file-ID, and base64 file parts map to Chat content parts.
Responses function and custom tool calls map to assistant tool calls; their
string outputs and text-part output arrays map to tool messages.

Function and custom tool definitions and named choices are wrapped in their Chat
Completions shapes. An `allowed_tools` choice converts each named function or
custom tool. `text.format` maps to `response_format`, `text.verbosity` to
`verbosity`, `max_output_tokens` to `max_completion_tokens`, and
`reasoning.effort` to `reasoning_effort`. Compatible sampling, metadata, user,
service-tier, log-probability, and parallel-tool fields retain their values.
Other members of the `reasoning` object, including `summary` and `context`, are
ignored rather than forwarded because Chat Completions has no equivalent. This
also lets clients send future reasoning options without breaking the bounded
conversion; the response still reports only the behavior that actually ran.
Streaming requests force `stream_options.include_usage` so the final Responses
event can carry usage when the selected provider supports it.

The converted request is passed to `handleChatCompletionsRequest`. This means a
Responses request accepts the same real provider selectors, named credential
profiles, `default`, virtual models, explicit `/key/...` selection, and
`/g/<gateway>` selection as Chat Completions. Each provider filters the
resulting Chat fields according to its declared capability. The converted
object and sanitized headers are passed directly, without serializing an
intermediate request or parsing the converted JSON a second time.

## Response conversion

A successful object-valued Chat Completions response is parsed up to 5 MiB. The
first choice becomes a completed Responses message item; Chat function and
custom tool calls become separate `function_call` and `custom_tool_call` output
items. Prompt, completion, cached, and reasoning token counts are renamed to the
Responses usage shape. A `length` finish reason produces `status: "incomplete"`;
other finish reasons produce `completed`. Non-successful upstream responses
keep their status and error body.

When `CHAT_RESPONSE_METADATA_ENABLED=true`, the `llm_proxy` object produced by
the selected Chat route is retained on the converted Responses object. In a
stream it appears on the final `response.completed` or `response.incomplete`
event's `response`, preserving the concrete provider, model, credential slot,
Gateway route, request ID, and timing metadata without adding a Chat chunk to
the client-visible Responses stream.

For `text/event-stream`, a `TransformStream` incrementally converts Chat chunks
to typed Responses events. It emits response lifecycle events, message/content
item creation, `response.output_text.delta`, function-call item creation,
`response.function_call_arguments.delta`, matching done events, and a final
`response.completed` or `response.incomplete`. Custom calls use the matching
`response.custom_tool_call_input.delta` and done events.

Multiline SSE data is joined before parsing.

The converter caps each SSE record at 1 MiB, retained text at 4 MiB, retained
tool arguments at 4 MiB, tool metadata at 64 KiB, tool calls at 64, and output
items at 64. These independent limits leave headroom beneath the Workers
128 MiB isolate limit while the converter retains the content required to
construct the final Responses event. Exceeding a limit or receiving malformed
SSE emits a terminal `error` event, emits no success terminal event, and
cancels the upstream stream.

Success requires the `[DONE]` sentinel. A stream that ends without it emits a
terminal `error` event and no success event. Backpressure and downstream
cancellation otherwise propagate through the Chat request path. Consequently,
the final event retains at most 8 MiB of generated content: up to 4 MiB of text
plus up to 4 MiB of tool arguments, with item and metadata overhead bounded
separately.

## Ignored and unsupported features

The Worker has no persistent conversation state and does not execute tools.
Top-level Responses request fields without a supported Chat Completions
conversion are ignored rather than forwarded: `background`,
`context_management`, `conversation`, `include`, `max_tool_calls`,
`previous_response_id`, `prompt`, `moderation`, `prompt_cache_key`,
`prompt_cache_options`, `prompt_cache_retention`, `safety_identifier`,
`stream_options`, and `truncation`. The converted response reports the behavior
that actually ran, such as `background: false`, `previous_response_id: null`,
and `truncation: "disabled"`. Unsupported members nested inside the top-level
`reasoning` object are likewise ignored, while `reasoning` itself must remain an
object when present.

Stored responses (`store: true`), built-in tools, file URLs, item references,
non-text tool-output parts, and unsupported nested input, text, or tool options
return HTTP 400 because silently removing them would change the remaining
request structure or provider-side data handling. Unknown top-level fields are
also rejected. Function and custom tools remain supported because their
execution stays with the client, matching Chat Completions semantics.

Ignoring the listed top-level fields is a compatibility tradeoff: the request
can succeed without the state, background, prompt-template, inclusion, or
truncation behavior those fields requested. Callers that require those
semantics must use a provider-native Responses endpoint or a separate stateful
service. Built-in tool and non-convertible input constructs remain fail-closed
because removing them would alter the converted messages or tool set.

## References

- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Migrating to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)
