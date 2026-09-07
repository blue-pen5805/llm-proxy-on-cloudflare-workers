# Cloudflare AI Gateway Integration

## Goals and boundary

The Worker can route supported provider traffic through Cloudflare AI Gateway
without changing its public authentication contract. Gateway performs its own
logging, analytics, caching, retry, or fallback behavior according to the
operator's Gateway configuration; the Worker is responsible for constructing
Gateway URLs, headers, account-level REST API requests, Compatibility Endpoint
requests, and explicit Universal Endpoint payloads.

## Gateway selection

`CLOUDFLARE_ACCOUNT_ID` is required for any Gateway context. A leading
`/g/<gateway>/` path selects that Gateway for one request and is removed
before normal routing. Using that prefix without an account ID is a
client-visible HTTP 400 configuration error.

Without the prefix, a Gateway context is created when the account ID is set
and any of the following apply: `AI_GATEWAY_NAME` is configured,
`ALWAYS_USE_AI_GATEWAY=true`, or the path is an account-level `/ai` REST
route. The selected Gateway is `AI_GATEWAY_NAME` when present and otherwise
`default`.

Strict mode (`ALWAYS_USE_AI_GATEWAY=true`) forbids direct provider fallback. The
API token is required by schema and Custom Provider synchronization, not by
every inference request.

If `CF_AIG_TOKEN` exists, requests add
`cf-aig-authorization: Bearer <token>`. The token is never returned verbatim by
the status handler.

The account-level REST API uses the separate `CLOUDFLARE_API_TOKEN` as its
upstream Bearer credential. Both tokens are masked by the status handler.

## Request modes

### Account-level REST API

The Worker reserves four exact POST routes: `/ai/run`,
`/ai/v1/chat/completions`, `/ai/v1/responses`, and `/ai/v1/messages`. They map
to the same suffix under:

```text
https://api.cloudflare.com/client/v4/accounts/<account>/ai/...
```

Request and response bodies are streamed without format conversion. The Worker
replaces proxy authentication with `Authorization: Bearer
<CLOUDFLARE_API_TOKEN>` and overwrites `cf-aig-gateway-id` with the selected
Gateway. `/g/<gateway>/ai/...` selects an explicit Gateway; otherwise
`AI_GATEWAY_NAME` or the fallback ID `default` is used. No other `/ai` path is
forwarded. Gateway/account path segments are validated and URL-encoded.

Header sanitization preserves client Gateway tuning while reserving
authentication, BYOK selection, and cache partitioning to the operator; see
[credential isolation](security_config.md#credential-isolation). REST
authorization and the selected Gateway ID are applied after sanitization.

### Provider endpoint

Pass-through, model-list, and status requests for a supported provider are sent
to:

```text
https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider>/<path>
```

Provider-specific, path-aware authentication headers are included. This preserves
endpoint differences such as Google AI Studio's Bearer authentication for
OpenAI-compatible paths and `x-goog-api-key` for native Gemini paths. Providers
absent from the locally maintained supported set are called directly unless
strict Gateway routing is enabled.

In strict mode, provider operations with a native AI Gateway route use that
route. An operation without a native route uses an account-level
Custom Provider whose display name is `LLM Proxy / <name>`. Simple provider
names produce a stored slug of `llm-proxy-<name>` and therefore a Gateway URL
provider segment of `custom-llm-proxy-<name>`. Names that require slug
normalization receive a deterministic hash suffix so distinct configured names
do not silently collapse to the same slug.

### Custom Provider path behavior

Cloudflare's [Custom Providers documentation](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
defines the provider path as a direct append to `base_url`. The Worker's
integration contract accounts for the following effective Gateway routing
behavior, which is not part of Cloudflare's documented platform contract:

| Configured Base URL      | Gateway provider path | Effective upstream URL              |
| ------------------------ | --------------------- | ----------------------------------- |
| `https://example.com/v1` | `/models`             | `https://example.com/models`        |
| `https://example.com`    | `/models`             | `https://example.com/v1/models`     |
| `https://example.com`    | `/v2/models`          | `https://example.com/v2/models`     |
| `https://example.com`    | `/vABCDE/models`      | `https://example.com/vABCDE/models` |

Gateway omits a final Base URL segment shaped like `/v[^/]+`. A Base URL
without such a final segment receives an implicit `/v1` before the requested
path, except when the requested path begins with a segment shaped like
`/v[^/]+`.

Strict mode compensates for this behavior. For a Base URL ending in `/v[^/]+`,
synchronization keeps the complete URL and repeats the final segment at the
start of each Gateway path. For any other Base URL, synchronization appends a
`/v1` sentinel and sends the adapter prefix and operation path after it. This
managed-provider path construction produces the same upstream URL as direct
routing. Direct requests concatenate the configured Base URL and operation path
without the transformation.

The provider-specific Gateway endpoint preserves native request bodies and
supports non-standard paths; it does not apply the Compatibility Endpoint
contract to incompatible operations.

Custom Providers are synchronized by `npm run secrets:deploy` before Worker
secrets are applied. The helper lists account providers and creates missing
managed definitions or updates their routing metadata. It does not store
provider credentials in Custom Provider metadata, delete stale definitions, or
overwrite an existing slug owned by a different display name. Synchronization uses
`CLOUDFLARE_API_TOKEN` with `AI Gateway - Edit` permission and sends no management
API requests during `--dry-run`.

When no local provider key exists, a single request without an upstream
`Authorization` header is built so AI Gateway BYOK can inject its stored
credential. Amazon Bedrock and Azure OpenAI model discovery are exceptions:
the Worker sends no model-list request unless the provider's required local
credential and routing identifier are both valid. When a local credential
exists, adapters can transform it before the Gateway request is built. Azure
OpenAI chat uses the provider-native Gateway path because the resource and
deployment are URL segments. Vertex AI uses Google Chat or publisher-specific inference;
Amazon Bedrock selects region-specific matching APIs or Converse conversion.
Workers AI inference uses the account REST API and requires a selected
`CLOUDFLARE_API_KEY`; it cannot use Gateway BYOK alone.

Vertex AI is Gateway-only and requires `CF_AIG_TOKEN` plus
`GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON`. The JSON must include `region`; the
Worker validates and Base64-encodes it for AI Gateway, which generates and
refreshes short-lived Google access tokens. Vertex chat and pass-through routes
are rejected when either required credential is absent.

### OpenAI-compatible chat

Automatic chat routing uses the selected provider's inference endpoint. The
adapter first prefers the requested public API when a matching capability is
declared, then chooses a model-specific conversion endpoint or its default.
Messages, GenerateContent, and Converse payloads and responses are converted
at this boundary; providers with a Chat Completions endpoint retain Chat format.
The concrete model is sent without the proxy's provider selector. Automatic
routing does not use Gateway's Unified `/compat/chat/completions` endpoint.
See [Native inference](native_inference.md) for endpoint selection and limits.

Automatic credential selection puts the key selected by striped per-isolate
rotation first, shuffles eligible remaining keys, and allows at most four
attempts. Each attempt lazily builds its payload, provider path, authentication,
and metadata for that credential. Another credential is tried only after a
network error, HTTP 401/403, or HTTP 429. Request-conversion errors and other
upstream errors return immediately. An explicit `/key/<selection>` sends one
request, so fallback cannot override the caller's selection.

The fallback loop retains the latest retryable HTTP response in case later
attempts fail at the network layer. A newer response replaces it, and the
superseded body is cancelled without buffering. Cancellation failure cannot
trigger another credential attempt or override a received response. Response
credential metadata follows the latest received response, even when a later
credential attempt fails without an HTTP response. Aborts and
local preparation or outcome-observer errors stop the loop and release any
retained body; cancellation is checked again after lazy request preparation.
This follows the [Workers ReadableStream cancellation API](https://developers.cloudflare.com/workers/runtime-apis/streams/readablestream/#methods).

### Converted compatibility APIs

Responses and Messages share the selected provider transport and credential
attempt loop. [Native inference](native_inference.md) defines when their lazy
Chat conversion runs for each concrete virtual-model candidate.

### Universal Endpoint and compatibility pass-through

`POST /g/<gateway>/` accepts the repository's Universal Endpoint request shape,
validates provider names against both the Gateway-supported set and the local
provider registry attached to the request, injects selected path-specific
provider headers, and
forwards the mapped steps to Gateway's Universal Endpoint. Gateway providers
without a local adapter fail with HTTP 400. This also normalizes each optional
endpoint to a bounded, safe relative path. Dot-segment traversal is rejected
before dispatch, including percent-encoded dot segments and paths with query
strings. Step endpoint queries, including credential-like names, are retained
as provider-native payload. Incoming-URL credential removal does not apply to
these nested fields; their preservation is an intentional contract and does not
bypass proxy authentication. No proxy or configured provider credentials are
automatically copied into step URLs. This explicit route is available
alongside automatic provider-native inference.
`POST /g/<gateway>/compat/chat/completions` forwards directly to Gateway
`/compat/chat/completions` after stripping proxy credentials. No other path under
`/compat` is exposed.

Gateway metadata is added after concrete routing and credential selection.
Nested virtual models retain the outer requested name. Client entries take
precedence, invalid JSON passes through, and additions stop at Cloudflare's
five-entry limit. The [API metadata
contract](../../../user/api/ai-gateway.md#request-metadata) defines field names,
priority, and the Universal Endpoint credential omission. See [Cloudflare custom
metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/).

## Provider support contract

The supported-provider arrays in `src/ai_gateway/const.ts` are static and do not
use dynamic Gateway discovery. The arrays, current Cloudflare documentation,
design documentation, and integration tests define provider support together.
Operational contracts such as OpenRouter are documented and covered by
integration tests. Strict routing marks configured custom endpoints explicitly
so a name that matches a Cloudflare-native provider cannot escape its managed
Custom Provider route. Operation-level exceptions and separate inference origins
are defined in [provider API
boundaries](native_inference.md#provider-api-boundaries).
[OpenCode](opencode.md) uses separate Custom Providers; its credential-free
protocol catalog lookup remains direct in both routing modes.

## References

- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [AI Gateway OpenAI-compatible endpoint](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)
- [AI Gateway Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/)
- [AI Gateway provider endpoints](https://developers.cloudflare.com/ai-gateway/providers/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [AI Gateway Custom Provider API](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/custom_providers/)
