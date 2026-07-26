# Compatibility Response Metadata

## Purpose and scope

The OpenAI-compatible Chat Completions and converted Responses or Messages routes add
request-scoped routing and timing metadata to routed responses. This makes the
proxy's actual provider selection visible to clients, including when `default`,
a virtual model, key rotation, or AI Gateway changes the concrete upstream
route.

This is a route-specific, operator-enabled compatibility extension, not a
proxy-wide response envelope. `CHAT_RESPONSE_METADATA_ENABLED` defaults to
`false`; while disabled, Chat Completions and converted Responses or Messages output omit
the extension. Provider pass-through, AI Gateway REST, Universal Endpoint,
model discovery, and local pre-routing errors do not include the extension.

## Metadata contract

The extension is named `llm_proxy` to identify its owner and purpose clearly
without colliding with fields defined by the OpenAI Chat Completions schema. The
proxy owns this field and replaces an upstream `llm_proxy` field if one is
present. It contains:

| Field                 | Meaning                                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| `request_id`          | The request's `cf-ray` value, or the proxy-generated request ID                    |
| `provider`            | Concrete provider selected for the returned response                               |
| `model`               | Concrete, provider-native model sent upstream                                      |
| `requested_model`     | Model selector supplied by the client after resolving `default`                    |
| `credential_profile`  | Selected credential profile (`default` when unnamed)                               |
| `credential_index`    | Zero-based configured credential slot; omitted for Gateway-managed credentials     |
| `via_ai_gateway`      | Whether the selected upstream request used AI Gateway                              |
| `gateway`             | Selected Gateway ID; present only when `via_ai_gateway` is true                    |
| `started_at`          | ISO 8601 time at which chat request handling began                                 |
| `headers_received_ms` | Milliseconds from handler start until the selected response headers were available |
| `completed_at`        | ISO 8601 time at which the enriched JSON or metadata SSE chunk was produced        |
| `duration_ms`         | Milliseconds from handler start to `completed_at`                                  |

Credential values, fragments, fingerprints, account IDs, request or response
content, and arbitrary upstream headers are never included. Credential indexes
follow the same slot-only disclosure policy as `/status` and structured logs;
they can change when operator configuration is reordered.

## Non-streaming responses

An object-valued `application/json` response receives `llm_proxy` as an additive
top-level field, including an upstream JSON error response after the route has
been selected. The proxy parses at most 5 MiB. If the body exceeds the limit, is
malformed, is not a JSON object, or has a non-JSON content type, it is returned
unchanged. A local error produced before a concrete provider is selected does
not include the extension. Headers that describe the source body representation
or validator (`Content-Length`, `Content-Encoding`, `Content-MD5`, `Digest`, and
`ETag`) are removed when the body is rewritten.

## Streaming responses

A `text/event-stream` body is streamed. A transform reads only
enough decoded text to find complete SSE lines and inserts one OpenAI-compatible
chunk with `choices: []` and `llm_proxy` immediately before `data: [DONE]`. If a
provider closes a valid event stream without a done marker, the chunk is emitted
at the end. Provider chunks are otherwise forwarded unchanged.

The Responses compatibility layer preserves the JSON `llm_proxy` object on the
converted top-level Responses object. For streaming output, it consumes the
Chat metadata chunk and includes the object in the final
`response.completed` or `response.incomplete` event's `response`. Earlier
Responses lifecycle events omit it because completion timing is not yet known.

The Messages compatibility layer likewise preserves `llm_proxy` at the top
level of converted JSON. For streaming output, it consumes the Chat metadata
chunk and adds the object to the final `message_delta` event; earlier Messages
events omit it.

The metadata chunk's `duration_ms` and `completed_at` therefore describe stream
completion rather than response-header arrival; `headers_received_ms` separately
captures upstream time to headers. Backpressure and downstream cancellation
propagate through the transform to the upstream body. The response is never
buffered in full.

## Virtual models and retries

Each concrete attempt returns its request-scoped route metadata alongside the
response and retryability decision. Retry and nested virtual-model selection
preserve the metadata belonging to the winning attempt. Consequently,
`requested_model` identifies the client-visible virtual model while `provider`
and `model` identify the candidate that actually produced the response.

## Observability boundary

Client response metadata complements rather than replaces Workers Logs and AI
Gateway analytics. It contains only information needed to explain the selected
chat route. Full retry history, rejected candidates, upstream URLs, provider
request IDs, and diagnostic errors are recorded only in content-minimal
structured logs.
