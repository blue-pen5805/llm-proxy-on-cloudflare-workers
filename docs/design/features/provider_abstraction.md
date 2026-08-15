# Provider Abstraction and Compatibility

## Responsibilities

The `Provider` interface defines upstream URL construction, key access, request
headers, chat request filtering, model request construction, and model response
normalization. `createProvider` composes the shared behavior with a small
`ProviderDefinition` containing only provider-specific values and hooks.
`defineProvider` exposes a `new ProviderName()` constructor interface without
coupling adapters through a base-class hierarchy.

This is an adapter boundary rather than a promise of complete semantic parity.
Provider adapters can filter chat fields, translate payloads, transform chat
responses, or declare model listing unsupported. Response transformation is an
explicit opt-in; the default preserves the upstream `Response`. Transformations
that parse a body must remain bounded and leave streaming, error, and unknown
responses unchanged.

## Provider registry

`ProviderRegistry` combines the built-in table in `src/providers.ts` with the
custom endpoint snapshot for one request. It owns discovery, route matching,
lazy construction, profile views, and instance reuse. Built-in providers take
precedence over a custom endpoint with the same name.

Client-supplied provider selectors match only registered names, never inherited
`Object.prototype` members. Provider routes use a `Set`, and object lookups
require own properties. This prevents inherited names such as `constructor`
from becoming routes or causing adapter construction failures.

Universal Endpoint steps must pass both Cloudflare's supported-provider check
and lookup in the request-scoped registry. A provider advertised by Gateway but
without a local adapter is therefore a client error rather than an undefined
constructor failure.

Availability is normally determined by whether a provider's configured key
list is non-empty. Workers AI has additional account configuration, while
custom endpoints are available by definition. Availability controls model
aggregation and status metadata. Routing resolves a registered provider class
even when it has no key.

AI Gateway-managed authentication is a deliberate exception: chat and model
requests may be sent
without a locally configured provider key when a Gateway context exists. The
Gateway then injects its stored credential. Adapters can rewrite provider-native
Gateway paths, opt model listing out of Gateway, or build a native Gateway chat
request when the Compatibility Endpoint does not support the provider shape.
Amazon Bedrock and Azure OpenAI opt model discovery out of this exception:
their model requests are omitted unless all locally required provider
credentials and routing identifiers are valid. This prevents aggregate model
discovery from sending predictably unauthenticated requests through Gateway.
Gateway-specific credential representations are index-aligned with the
provider's ordinary credential list so explicit and coordinated selection refer
to the same slot within the selected credential profile.
Providers may also declare Gateway as mandatory; direct chat and pass-through
then fail before any upstream request is attempted. Vertex AI uses this mode;
its service-account JSON is converted to the Gateway credential header instead
of being treated as a short-lived OAuth access token.

Registration does not imply complete compatibility. Providers declare three
capabilities independently:

- OpenAI-compatible chat translation;
- model-list translation;
- provider-specific pass-through.

A client selector that does not resolve to a registered provider or credential
profile is a request error and returns HTTP 400 on compatibility routes. A
registered provider that cannot serve because its operator credentials,
provider-specific settings, required Gateway, or Gateway token are absent
returns HTTP 503. Provider pass-through retains HTTP 404 for an unknown route.

Pass-through usually needs only a base URL and authentication. Chat and model
listing require format-specific implementation and tests.

Provider and client headers are merged with the Fetch API `Headers` abstraction
so field names remain case-insensitive. Provider-controlled authentication and
content-type values replace matching client values instead of producing multiple
wire values with different casing. Adapters can select authentication headers by
request path when one provider exposes endpoints with different credential
contracts. Google AI Studio uses `Authorization: Bearer` for its OpenAI-compatible
paths and `x-goog-api-key` for its native Gemini paths, including when the request
uses an AI Gateway provider endpoint.

## Custom OpenAI-compatible endpoints

Deployment configuration can register OpenAI-compatible upstreams without a
provider class. This covers self-hosted inference and vendor endpoints whose
authentication and response formats already follow the OpenAI contract.

Validated `CUSTOM_OPENAI_ENDPOINTS` entries join the same request-scoped
registry as built-in adapters. Invalid configuration prevents registry creation
and produces a non-disclosing HTTP 503 after authentication. The complete input
schema is in [Configuration](../../configuration.md#custom-openai-compatible-endpoints).

A registered endpoint supports pass-through at `/<name>/<path>`, chat through a
`<name>/<model>` selector, model aggregation through a static list or configured
models path, and status checks for each key. Static models avoid upstream I/O
and become `<name>/<model>` IDs owned by the custom endpoint.

Keys are optional. When present, the adapter uses Bearer authentication and the
same explicit and automatic selection policies as built-in providers. An
endpoint without keys is considered available, leaving origin access control to
the operator.

With `ALWAYS_USE_AI_GATEWAY=true`, all operations use the synchronized AI
Gateway Custom Provider. Otherwise, requests use the configured Base URL
directly. Custom Provider synchronization and path behavior are defined in the
[AI Gateway design](ai_gateway.md#custom-provider-path-behavior).

## Credential profiles

Credential profiles provide independent key pools for one provider without
duplicating its adapter or routing configuration. Scalar and array credential
forms create the `default` profile. A profile map can define `default` and
additional named pools. Profile names contain 1–64 letters, digits, `.`, `_`,
`~`, or `-`; the selector form is `<provider>:<profile>`, and provider names
cannot contain the reserved colon.

The registry resolves a selector to an adapter plus an immutable
credential-profile view. Concurrent requests may share the base adapter because
the selected profile is never stored as mutable instance state. Chat
Completions, Responses, Messages, provider pass-through, and Universal Endpoint
provider fields accept selectors. AI Gateway receives the base provider name
because profiles exist only at the proxy credential boundary. Unknown or
malformed named profiles never fall back to `default`.

Each profile has its own key array, rotation identifier, and cooldown state.
Explicit indices resolve only within the selected pool. Gateway credential
representations remain index-aligned with ordinary keys inside that pool.
Model aggregation and status enumerate the default view and every named view;
default model IDs use `<provider>/<model>`, while named IDs use
`<provider>:<profile>/<model>`. Structured logs identify named profiles without
exposing credential values or derived identifiers.

Auxiliary provider settings remain shared across profiles. Vertex AI is the
credential-shape exception: a profile contains one or more service-account
objects instead of strings, but selection and index alignment are unchanged.

## OpenAI-compatible chat flow

Official API definition:
[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
Last accessed for this compatibility contract: 2026-08-14.

1. Parse and validate the JSON body.
2. Resolve `default` or split `<provider>/<model>` at the first slash.
3. Resolve an API key index.
4. Let the adapter remove explicitly unsupported fields or translate provider
   differences, then remove the provider prefix from the model.
5. Send directly or construct an AI Gateway request.
6. Apply the provider's optional response transformation and forward the result.
7. When `CHAT_RESPONSE_METADATA_ENABLED=true`, add bounded `llm_proxy` metadata
   to an object-valued JSON response, or inject one final metadata chunk into an
   SSE response.

The shared OpenAI-compatible capability list tracks the current official Chat
Completions top-level parameters. Provider declarations may intentionally narrow
that list; a known parameter absent from such a declaration is removed. Fields
outside the known set are retained so provider extensions and newly introduced
Chat parameters are not removed merely because the proxy has not classified
them yet. Provider-specific known extensions such as Cerebras `suffix` remain
explicitly declared.

The metadata stage is disabled by default for strict client compatibility. Its
complete contract follows below.

The incoming abort signal is attached to the provider or Gateway subrequest so
client cancellation can stop avoidable work. The Worker enables the
`enable_request_signal` compatibility flag.

### Compatibility response metadata

The Chat Completions and converted Responses and Messages routes can add
request-scoped routing and timing metadata to routed responses. This
operator-enabled extension makes the concrete provider visible when `default`,
a virtual model, key rotation, or AI Gateway changes the route. Provider
pass-through, AI Gateway REST, Universal Endpoint, model discovery, and local
pre-routing errors do not include it.

The proxy owns the top-level `llm_proxy` field and replaces an upstream field of
the same name. It contains:

| Field                 | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `request_id`          | The request's `cf-ray` value, or the proxy-generated request ID         |
| `provider`            | Concrete provider selected for the returned response                    |
| `model`               | Concrete provider-native model sent upstream                            |
| `requested_model`     | Client selector after resolving `default`                               |
| `credential_profile`  | Selected profile (`default` when unnamed)                               |
| `credential_index`    | Zero-based credential slot; omitted for Gateway-managed credentials     |
| `via_ai_gateway`      | Whether the upstream request used AI Gateway                            |
| `gateway`             | Selected Gateway ID, only when AI Gateway was used                      |
| `started_at`          | ISO 8601 chat-handler start time                                        |
| `headers_received_ms` | Milliseconds from handler start until response headers arrived          |
| `completed_at`        | ISO 8601 time when enriched JSON or the metadata SSE chunk was produced |
| `duration_ms`         | Milliseconds from handler start to `completed_at`                       |

Credential material, account IDs, request or response content, and arbitrary
upstream headers are excluded. Credential indexes identify configuration slots
and can change when keys are reordered.

For an object-valued `application/json` response, the proxy parses at most 5
MiB and adds the field, including to an upstream JSON error after route
selection. Oversized, malformed, non-object, and non-JSON responses pass through
unchanged. Rewriting removes `Content-Length`, `Content-Encoding`,
`Content-MD5`, `Digest`, and `ETag` because they describe the source body.

For `text/event-stream`, a transform inserts one OpenAI-compatible metadata
chunk before `data: [DONE]`, or at the end of a valid stream without that
marker. Other chunks pass through. Responses and Messages converters place the
metadata on their protocol-specific final response update. The completion
fields therefore describe stream completion, while `headers_received_ms`
describes time to headers. Backpressure and cancellation propagate upstream.
Each SSE record is limited to 1 MiB; an oversized or malformed record produces
a terminal compatible error, suppresses metadata and the success marker, and
cancels the upstream stream.

Virtual-model retries retain metadata from the winning concrete attempt.
`requested_model` identifies the client-visible virtual model, while `provider`
and `model` identify the upstream that returned the response. Retry history,
rejected candidates, URLs, provider request IDs, and diagnostic errors remain
in content-minimal structured logs rather than client metadata.

## Converted compatibility flows

Responses and Messages validate their protocol-specific request, convert it to
Chat Completions, and invoke the ordinary chat flow. They therefore derive
compatibility from each provider's declared Chat capability rather than
provider-native Responses, Messages, or pass-through support.

Successful JSON and SSE responses are converted back to the selected public
protocol. Both streaming converters share the bounded Chat Completions SSE
decoder and implement only their protocol-specific state and event output.
Upstream errors pass through. The complete mappings, limits, and explicit
exclusions live in the [OpenAI-compatible API](../../api/openai-compatible.md#responses)
and [Anthropic-compatible API](../../api/anthropic-compatible.md#messages)
guides.

## Model aggregation flow

Every registered and custom provider is considered concurrently. Unavailable
providers return no models. Static lists avoid network access; other providers
receive a model-list request with a 60-second timeout. Fulfilled results are
converted to OpenAI model objects and prefixed with their route name. Rejected or
malformed responses are logged and omitted.
The optional `provider` query restricts fan-out before requests start and forms
part of the aggregate cache key. Model retrieval resolves an exact ID from this
bounded aggregate rather than introducing a separate provider capability.

## Extension requirements

A provider consists of a definition, registry entry, configuration/schema
support, contract tests, and documentation. Tests cover URL and header
construction, availability, supported chat fields, model conversion, direct
routing, and AI Gateway behavior independently. See
[Development and verification](../../development.md).

## References

- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare AI Gateway providers](https://developers.cloudflare.com/ai-gateway/providers/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
