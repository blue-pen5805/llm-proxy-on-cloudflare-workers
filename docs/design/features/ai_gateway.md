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
cost, and metadata per request. `cf-aig-authorization` is the exception: it is
always removed from client input, and only the operator-configured
`CF_AIG_TOKEN` may supply that credential. The Worker also applies REST
authorization and the route-selected Gateway ID after sanitization.

### Provider endpoint

Pass-through, model-list, and status requests for a supported provider are sent
to:

```text
https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/<provider>/<path>
```

Provider-specific authentication headers are included. Providers absent from
the locally maintained supported set are called directly instead.

When no local provider key exists, a single request without an upstream
`Authorization` header is built so AI Gateway BYOK can inject its stored
credential. When a local credential exists, adapters can transform it before
the Gateway request is built. Azure OpenAI chat uses the provider-native Gateway path because the
resource and deployment are URL segments. Vertex AI and Amazon Bedrock use the
Compatibility Endpoint for OpenAI-formatted chat; Bedrock provider-native paths
include the configured runtime region.

Vertex AI is Gateway-only and requires `CF_AIG_TOKEN` plus
`GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON`. The JSON must include `region`; the
Worker validates and Base64-encodes it for AI Gateway, which generates and
refreshes short-lived Google access tokens. Vertex chat and pass-through routes
are rejected when either required credential is absent.

### OpenAI-compatible chat

For providers in the OpenAI-compatible Gateway subset, automatic selection
shuffles configured keys and creates at most four Compatibility Endpoint
requests. It tries another credential only after a network error, HTTP 401/403,
or HTTP 429; deterministic client and provider errors return immediately. An
explicit `/key/<selection>` resolves one credential and sends exactly one
request, so fallback cannot override the caller's selection. The model is
rewritten to `<provider>/<model>` for Gateway's compatibility endpoint.

OpenRouter is retained in this subset because the Compatibility Endpoint has
been verified to accept it in production even though the current provider list
in Cloudflare documentation does not advertise that combination. Treat this as
an operational compatibility contract and reverify it when Gateway behavior
changes.

### Legacy Universal Endpoint and compatibility pass-through

`POST /g/<gateway>/` accepts the repository's Universal Endpoint request shape,
validates provider names against the supported set, injects selected provider
headers, and forwards the mapped steps to Gateway's Universal Endpoint. This
also normalizes each optional endpoint to a bounded, safe relative path. This
explicit route remains available even though normal OpenAI-compatible chat uses
the Compatibility Endpoint. `POST /g/<gateway>/compat/chat/completions` forwards
directly to that fixed Gateway endpoint after stripping proxy credentials. No
other path under `/compat` is exposed.

## Maintenance risk

The supported-provider arrays in `src/ai_gateway/const.ts` are code, not dynamic
Gateway discovery. They must normally be checked against current Cloudflare
documentation when providers are added or Gateway behavior changes. A tested
operational exception such as OpenRouter must be documented and covered by
integration tests. Custom endpoint names are not automatically
Gateway-supported.

## References

- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [AI Gateway OpenAI-compatible endpoint](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)
- [AI Gateway Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/)
- [AI Gateway provider endpoints](https://developers.cloudflare.com/ai-gateway/providers/)
