# Cloudflare AI Gateway Integration

## Goals and boundary

The Worker can route supported provider traffic through Cloudflare AI Gateway
without changing its public authentication contract. Gateway performs its own
logging, analytics, caching, retry, or fallback behavior according to the
operator's Gateway configuration; the Worker is responsible for constructing
Gateway URLs, headers, account-level REST API requests, Compatibility Endpoint
requests, and explicit Universal Endpoint payloads.

## Gateway selection

`CLOUDFLARE_ACCOUNT_ID` is required for any Gateway context. If
`AI_GATEWAY_NAME` is also configured, that Gateway becomes the default for
requests. A leading `/g/<gateway>/` path selects a different Gateway for one
request and is removed before normal routing.
Using that prefix without an account ID is a client-visible HTTP 400
configuration error.

`ALWAYS_USE_AI_GATEWAY=true` enables strict Gateway routing. It requires an
account ID, selects `AI_GATEWAY_NAME` when present, and otherwise selects the
Gateway named `default`. The explicit `/g/<gateway>/` prefix overrides that
selection for one request. Strict mode fails closed rather than
falling back to a direct provider request.

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

Client-supplied `cf-aig-*` control headers are retained on AI Gateway routes
because request-level Gateway settings intentionally take precedence over
Gateway defaults. This allows callers to control logging, cache keys, retries,
cost, and metadata per request. Credential-policy headers are exceptions:
`cf-aig-authorization` and `cf-aig-byok-alias` are always removed from client
input. Only the operator-configured `CF_AIG_TOKEN` may authenticate Gateway, and
clients cannot select among provider credentials stored in Gateway BYOK. The
Worker also applies REST authorization and the route-selected Gateway ID after
sanitization.

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
managed definitions or updates their Base URL, display name, enabled state, and
provider logo. Cline, Ollama, and NVIDIA NIM use the Base64-encoded SVG assets
stored with their adapters; other managed definitions retain Cloudflare's
generated logo. The helper does not store provider credentials in Custom
Provider metadata, delete stale definitions, or overwrite an existing slug
owned by a different display name. Synchronization uses
`CLOUDFLARE_API_TOKEN` with AI Gateway Write permission and sends no management
API requests during `--dry-run`.

When no local provider key exists, a single request without an upstream
`Authorization` header is built so AI Gateway BYOK can inject its stored
credential. Amazon Bedrock and Azure OpenAI model discovery are exceptions:
the Worker sends no model-list request unless the provider's required local
credential and routing identifier are both valid. When a local credential
exists, adapters can transform it before the Gateway request is built. Azure
OpenAI chat uses the provider-native Gateway path because the resource and
deployment are URL segments. Vertex AI and Amazon Bedrock use the Compatibility
Endpoint for OpenAI-formatted chat; Bedrock provider-native paths include the
configured runtime region.

Vertex AI is Gateway-only and requires `CF_AIG_TOKEN` plus
`GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON`. The JSON must include `region`; the
Worker validates and Base64-encodes it for AI Gateway, which generates and
refreshes short-lived Google access tokens. Vertex chat and pass-through routes
are rejected when either required credential is absent.

### OpenAI-compatible chat

For providers in the OpenAI-compatible Gateway subset, automatic selection puts
the credential selected by striped per-isolate rotation first, shuffles the
remaining keys, and creates at most four Compatibility Endpoint requests. It
tries another credential only after a network error, HTTP 401/403, or HTTP 429;
deterministic client and provider errors return immediately. An explicit
`/key/<selection>` resolves one credential and sends exactly one request, so
fallback cannot override the caller's selection. Each attempted credential is
logged with its actual slot. The model is rewritten to `<provider>/<model>` for
Gateway's compatibility endpoint.

OpenRouter is included in this subset under a tested operational contract for
the Compatibility Endpoint.

### OpenAI-compatible Responses

The public Responses compatibility route first converts its request to Chat
Completions. The converted request then follows the same Compatibility Endpoint,
provider-native chat, or strict Custom Provider path as a direct Chat
Completions request. AI Gateway therefore receives Chat Completions format; the
Worker converts the returned JSON or SSE chunks back to Responses format.

### Anthropic-compatible Messages

The public Messages compatibility route also converts through Chat
Completions. Its converted request follows the same Compatibility Endpoint,
provider-native chat, or strict Custom Provider path. AI Gateway receives Chat
Completions format, and the Worker converts successful JSON or SSE back to
Anthropic Messages format. The provider-native
`/<provider>/v1/messages` pass-through route has a separate contract.

### Universal Endpoint and compatibility pass-through

`POST /g/<gateway>/` accepts the repository's Universal Endpoint request shape,
validates provider names against both the Gateway-supported set and the local
request-scoped Provider Registry, injects selected provider headers, and
forwards the mapped steps to Gateway's Universal Endpoint. Gateway providers
without a local adapter fail with HTTP 400. This also normalizes each optional
endpoint to a bounded, safe relative path. This explicit route is available
alongside normal OpenAI-compatible chat through the Compatibility
Endpoint. `POST /g/<gateway>/compat/chat/completions` forwards directly to that
fixed Gateway endpoint after stripping proxy credentials. No other path under
`/compat` is exposed.

Gateway-bound inference requests add bounded `cf-aig-metadata` tags for the
resolved provider, requested concrete model when known, the client-requested
virtual model when one was resolved, the public proxy endpoint, and the
selected provider credential profile and key slot. The virtual-model tag
retains the outer client-requested name when resolution passes through nested
virtual models. `llm_proxy_credentials` is a scalar string in
`<credential-profile>:<provider-key-index>` form; the index is `null` when AI
Gateway BYOK supplies the credential. Universal Endpoint requests add the
endpoint tag but omit credentials because their steps can select different
providers, profiles, and key slots. Proxy fields are considered in
virtual-model, endpoint, provider, concrete-model, and credentials order.
Existing client metadata wins on collisions. Invalid client JSON is preserved,
and proxy tags fill only unused entries within Cloudflare's five-entry metadata
limit. No credential value, authenticated proxy-key slot, or derived
fingerprint is included. See [Cloudflare custom metadata](https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/).

## Provider support contract

The supported-provider arrays in `src/ai_gateway/const.ts` are static and do not
use dynamic Gateway discovery. The arrays, current Cloudflare documentation,
design documentation, and integration tests define provider support together.
Operational contracts such as OpenRouter are documented and covered by
integration tests. Strict routing marks configured custom endpoints explicitly
so a name that matches a Cloudflare-native provider cannot escape its managed
Custom Provider route.

## References

- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [AI Gateway OpenAI-compatible endpoint](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)
- [AI Gateway Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/)
- [AI Gateway provider endpoints](https://developers.cloudflare.com/ai-gateway/providers/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
- [AI Gateway Custom Provider API](https://developers.cloudflare.com/api/resources/ai_gateway/subresources/custom_providers/)
