# Anthropic-Compatible Messages API

## Purpose and boundary

This compatibility feature is experimental. Its accepted subset and converted
JSON/SSE contract are defined in this document.

The proxy exposes `POST /v1/messages` and `/messages` for Anthropic Messages
clients. It converts the request to Chat Completions, runs the Chat
Completions handler, and converts successful Chat JSON or SSE back to the
Anthropic Messages shape. It does not call a provider-native Messages endpoint;
provider-native Messages is available through a pass-through path such as
`/anthropic/v1/messages`.

The Messages and Chat routes use the same provider selection, virtual-model
fallback, credential profiles, key rotation and cooldown, provider filtering,
AI Gateway routing, cancellation, and optional response metadata behavior. The
conversion is deliberately narrower than the provider-native API.

## Request conversion

The handler reads at most 10 MiB and requires `model`, `max_tokens`, and
`messages`. The model retains its provider-qualified, named-profile, `default`,
or virtual-model selector until the Chat handler resolves it.

User and assistant text map to Chat messages. Anthropic base64 and URL image
sources become Chat image URLs. Assistant `tool_use` blocks become function
tool calls, and user `tool_result` blocks become tool messages. The top-level
`system` value becomes a system message. Custom tool definitions, `auto`,
`any`, `tool`, and `none` tool choices, parallel-tool control, stop sequences,
token limits, sampling values, streaming, and `metadata.user_id` map to their
direct Chat equivalents.

The converted request is passed to `handleChatCompletionsRequest`. Consequently,
Messages accepts the same real providers, named credential profiles, `default`,
virtual models, `/key/...` selection, and `/g/<gateway>` selection as Chat
Completions. Each provider filters Chat fields according to its declared
capability. The converted object and sanitized headers are passed directly,
without serializing an intermediate request or parsing the converted JSON a
second time.

## Response conversion

A successful object-valued Chat response is parsed up to 5 MiB. Assistant text,
refusals, and function calls become Anthropic `text` and `tool_use` content
blocks. Finish reasons map to `end_turn`, `max_tokens`, `tool_use`, or `refusal`,
and Chat usage becomes Anthropic input, output, and cached-input token counts.
Non-successful upstream responses retain their status and body.

For `text/event-stream`, a `TransformStream` converts Chat chunks incrementally
into `message_start`, `content_block_start`, `content_block_delta`,
`content_block_stop`, `message_delta`, and `message_stop` events. Multiline SSE
data is joined before parsing.

Anthropic content blocks are sequential, while Chat chunks may interleave text
and tool-call deltas. The converter therefore streams text at index 0, retains
tool arguments, then emits each `tool_use` block complete after closing the text
block.

The converter independently caps each SSE record at 1 MiB, cumulative text at
4 MiB, cumulative tool arguments at 4 MiB, tool calls at 64, and output items
at 64. These limits leave headroom beneath the Workers 128 MiB isolate limit.
Malformed, oversized, or truncated streams emit a terminal error without
`message_stop` and cancel the upstream stream. A stream is truncated if it ends
without `[DONE]`. Backpressure and downstream cancellation otherwise propagate
through the Chat path.

When `CHAT_RESPONSE_METADATA_ENABLED=true`, JSON output retains the Chat route's
top-level `llm_proxy` object. Streaming output places it on the final
`message_delta` event. This additive field is proxy-specific and disabled by
default.

## Explicitly unsupported features

Unknown request fields and content-block fields are rejected rather than
silently discarded. The experimental conversion excludes documents,
search results, citations, prompt-cache controls, extended/adaptive thinking,
server tools, MCP connectors, containers, context management, and other beta or
provider-executed features without a direct Chat Completions equivalent.

Clients that require the complete Anthropic wire contract use the provider
pass-through route. The compatibility endpoint includes only direct, tested
mappings that preserve semantics and require no proxy state or tool execution.

## References

- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic API getting started](https://platform.claude.com/docs/en/get-started)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)
