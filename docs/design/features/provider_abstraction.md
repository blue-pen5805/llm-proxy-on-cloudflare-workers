# Provider Abstraction and Compatibility

## Responsibilities

`Provider` owns credential profiles, availability, upstream URL construction,
authentication, and transport. `createProvider` composes these responsibilities
from a `ProviderDefinition`; `defineProvider` provides the constructor interface
used by the registry. Inference and model discovery are explicit operations in
`endpoints`, not methods inherited from a generic Chat implementation.

Each inference operation owns request construction and its optional response
transformation. `chatCompletionsEndpoint(path, options)` filters declared Chat
parameters; `jsonEndpoint(pathOrPrepare, options)` preserves a native JSON
payload or applies a provider-specific envelope. `convertedChatEndpoint(codec)`
pairs Chat-to-provider preparation with the reverse JSON/SSE conversion.
These operations share serialization and authentication, while retaining native
Gateway path differences such as Azure deployment routing.

`resolveInference(model, protocol)` selects one operation per concrete candidate.
An explicit operation matching the requested public protocol takes priority,
including a provider-hosted compatibility API. The provider's proprietary API
and conversion fallback do not override a match. Without a match it selects the declared Chat
fallback or Chat endpoint. Selection happens before request conversion; every
credential attempt and the resulting response use that same operation. Provider
hooks receive the selected credential-profile view as `this`. See
[Native inference](native_inference.md) for resolution and transport details.

The `models` operation declares its path, optional prerequisite validation,
response conversion, static list, and Gateway credential/capability settings.
Model aggregation and connectivity checks use the same GET preparation and
authenticate once per attempted key. Custom Provider synchronization reads the
same capability declaration.

For example, OpenAI declares:

```ts
endpoints: {
  chat_completions: chatCompletionsEndpoint(),
  responses: jsonEndpoint("/responses"),
  models: { path: "/models" },
}
```

An absent operation is unsupported. No Chat or model path is inferred from a
provider's base URL or authentication scheme. Inference without a matching
operation or conversion fallback returns HTTP 400 before network I/O. An absent
`models` operation is omitted from discovery and leaves connectivity status
`unknown`, including through Gateway. Universal Endpoint steps without an
explicit `endpoint` require a declared, fixed Chat path.

Custom OpenAI configuration fields `chatCompletionPath` and `modelsPath` map into
the operation declarations. Their configuration defaults remain
`/chat/completions` and `/models`. Optional `responsesPath` and `messagesPath`
declare the corresponding native JSON operations. Absent native paths use the
shared Chat conversion fallback. Custom operations share Bearer authentication
and credential profiles; a path declaration does not change the auth scheme.

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
and lookup in the registry attached to the request. A provider advertised by
Gateway but
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
Gateway paths, opt model listing out of Gateway, and select native inference
endpoints with paired request and response codecs. A model-specific resolver
overrides the provider default; see [Native inference](native_inference.md).
Workers AI inference requires its selected local API key for the account REST
API, and Vertex AI requires local service-account configuration.
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
registered provider that cannot serve because declared required local
credentials, provider-specific settings, a required Gateway, or a Gateway token
are absent returns HTTP 503. Operations that do not require local credentials
can use upstream-managed authentication; the upstream determines the response
when its authentication requirements are not satisfied. Provider pass-through
retains HTTP 404 for an unknown route.

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

Validated `CUSTOM_OPENAI_ENDPOINTS` entries join the same configuration-specific
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

Responses and Messages first resolve the concrete provider and prefer a
declared same-protocol endpoint. These routes preserve provider payloads and
response streams. Matching capabilities and model overrides are defined in
[Native inference](native_inference.md).

Without a matching capability, the protocol-specific request is converted
lazily to Chat Completions. This fallback derives compatibility from the
provider's Chat conversion capability. Message and nested system blocks retain
their order within the request byte limit; array length does not become a
JavaScript function argument count.

On conversion paths, successful JSON and SSE responses are converted back to the selected public
protocol. Both streaming converters share the bounded Chat Completions SSE
decoder and implement only their protocol-specific state and event output.
Responses separately bounds cumulative logprobs to 4 MiB of serialized converted
batches, counting both the text-event and output-item representations, including
byte arrays and alternative tokens. Empty logprob batches consume no budget.
Exceeding this budget emits a terminal error and cancels the upstream stream.
Upstream errors pass through. The complete mappings, limits, and explicit
exclusions live in the [OpenAI-compatible API](../../api/openai-compatible.md#responses)
and [Anthropic-compatible API](../../api/anthropic-compatible.md#messages)
guides.

## Model aggregation flow

Declared model-list operations are considered concurrently. Providers without
that operation or the required availability return no models. Static lists avoid
network access; other providers
receive a model-list request with a 60-second timeout. Automatic discovery
starts at the first key. HTTP 429 retries sequential later keys, up to three
attempts or the configured key count, without advancing striped rotation.
Other failures and explicit key selections do not rotate. Fulfilled results are
converted to OpenAI model objects and prefixed with their route name. Registry
enumeration failures, rejected requests, and malformed responses are logged
and omitted independently. Each provider's retained batch is validated before
any entries are added: every entry must be an object with a non-empty string ID.
An invalid batch does not remove models from healthy providers or enter the
aggregate cache. Exceeding the per-provider count limit marks the response as
truncated while still allowing models from subsequent providers within the
aggregate byte limit.
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

Inference operations can independently disable native Gateway routing with
`supportsAiGateway: false`, using direct connections in non-strict mode and
Custom Providers in strict mode. An operation's optional `upstream` supplies a
separate inference origin and internal Custom Provider name; it leaves the
provider's pass-through origin intact. The deployment synchronizer registers
these origins once across protocols and credential profiles. Operations with a
separate origin do not supply a provider-relative Universal Endpoint default.
See [Native inference boundaries](native_inference.md#provider-api-boundaries).
