# Anthropic-compatible API

The Anthropic-compatible API provides an experimental Messages conversion to
the proxy's Chat Completions path. It does not call a provider-native Messages
endpoint. Use a pass-through path such as `/anthropic/v1/messages` when the
complete provider-native contract is required.

The compatibility API uses the same provider selection, virtual-model
fallback, credential profiles, key rotation and cooldown, provider filtering,
AI Gateway routing, cancellation, and optional response metadata behavior as
Chat Completions. Its accepted subset and converted JSON and SSE contract are
defined below.

The compatibility contract follows the
[Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create),
last verified on 2026-08-14.

## Messages

`POST /v1/messages` and its `/messages` alias accept an Anthropic Messages body
whose `model` uses the same provider-qualified selector as the
OpenAI-compatible API:

```bash
curl https://your-worker.example/v1/messages \
  --header "x-api-key: $PROXY_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.4",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Why is the sky blue?"}],
    "stream": true
  }'
```

### Request conversion

The handler reads at most 10 MiB and requires `model`, `max_tokens`, and
`messages`. The model retains its provider-qualified, named-profile, `default`,
or virtual-model selector until the Chat handler resolves it.

User and assistant text map to Chat messages. Anthropic base64 and URL image
sources become Chat image URLs. Assistant `tool_use` blocks become function
tool calls, and user `tool_result` blocks become tool messages. A missing tool
result content becomes an empty message, while `is_error` is removed because
Chat has no equivalent.

The top-level `system` value and `system` role messages, including
`mid_conv_system` text, become system messages. Custom tool definitions,
including the explicit `type: "custom"` form, and `auto`, `any`, `tool`, and
`none` tool choices map to their Chat equivalents. Parallel-tool control, stop
sequences, token limits, sampling values, streaming, and `metadata.user_id` are
also retained. `output_config.effort` maps to `reasoning_effort`, and
`output_config.format` maps to a Chat JSON Schema response format named
`response`. Function-tool `strict` maps to the corresponding Chat option.
Prompt-cache annotations on otherwise supported system, text, image, tool-use,
tool-result, and tool-definition objects are removed.

The converted object and sanitized headers are passed directly to the Chat
Completions handler without serializing an intermediate request or parsing the
converted JSON a second time. Consequently, Messages accepts the same real
providers, named credential profiles, `default`, virtual models, explicit key
selection, and Gateway selection as Chat Completions. Each provider filters
Chat fields according to its declared capability.

### Response conversion

A successful object-valued Chat response is parsed up to 5 MiB. Assistant text,
refusals, and function calls become Anthropic `text` and `tool_use` content
blocks. Finish reasons map to `end_turn`, `max_tokens`, `tool_use`, or
`refusal`, and Chat usage becomes the current Anthropic usage shape. Fields
without Chat data are present with `null`, including container, refusal details,
cache creation, inference geography, output-token details, server-tool usage,
and service tier. Text blocks contain `citations: null`. Non-successful upstream
responses retain their status and body.

For `text/event-stream`, a `TransformStream` converts Chat chunks incrementally
into `message_start`, `content_block_start`, `content_block_delta`,
`content_block_stop`, `message_delta`, and `message_stop` events. Multiline SSE
data is joined before parsing. Message start and delta events use the current
message, delta, and usage field sets.

Anthropic content blocks are sequential, while Chat chunks may interleave text
and tool-call deltas. The converter therefore streams text at index 0, retains
tool arguments, then emits each `tool_use` block complete after closing the text
block.

When `CHAT_RESPONSE_METADATA_ENABLED=true`, JSON output retains the Chat route's
top-level `llm_proxy` object. Streaming output places it on the final
`message_delta` event. This additive field is proxy-specific and disabled by
default.

### Streaming limits and failures

The converter independently caps each SSE record at 1 MiB, cumulative text at
4 MiB, cumulative tool arguments at 4 MiB, tool calls at 64, and output items
at 64. These limits leave headroom beneath the Workers 128 MiB isolate limit.

Malformed or oversized streams emit a terminal error without `message_stop`
and cancel the upstream stream. A stream is also treated as truncated when it
ends without `[DONE]`. Backpressure and downstream cancellation otherwise
propagate through the Chat path.

### Ignored and unsupported features

Top-level Messages fields without a supported Chat Completions conversion,
including unknown fields, are ignored rather than forwarded. Unsupported
members of otherwise convertible objects and independently removable content
blocks, system blocks, tool-result parts, tool definitions, and tool choices
are also omitted while compatible parts of the same request are converted.
This includes documents, search results, citations, thinking content, server
tools, MCP connectors, containers, context management, future extensions, and
prompt-cache annotations.

HTTP 400 is reserved for a malformed request envelope, missing required fields,
or an invalid shape for a recognized value required to perform a safe
conversion. The converted response reports only the behavior that actually
ran. The compatibility endpoint includes only direct, tested mappings that
preserve semantics and require no proxy state or tool execution.

## Token counting

`POST /v1/messages/count_tokens` returns an Anthropic-shaped HTTP 400 error.
Token counting is not approximated because Chat Completions has no equivalent
operation that preserves Anthropic tokenization.

## References

- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic API getting started](https://platform.claude.com/docs/en/get-started)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)
