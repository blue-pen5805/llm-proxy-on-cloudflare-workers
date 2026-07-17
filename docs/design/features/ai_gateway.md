# Cloudflare AI Gateway Integration

## Goals and boundary

The Worker can route supported provider traffic through Cloudflare AI Gateway
without changing its public authentication contract. Gateway performs its own
logging, analytics, caching, retry, or fallback behavior according to the
operator's Gateway configuration; the Worker is responsible for constructing
Gateway URLs, headers, Compatibility Endpoint requests, and explicit Universal
Endpoint payloads.

## Gateway selection

`CLOUDFLARE_ACCOUNT_ID` is required for any Gateway context. If
`AI_GATEWAY_NAME` is also configured, that Gateway becomes the default for
requests. A leading `/g/<gateway>/` path selects a different Gateway for one
request and is removed before normal routing.

If `CF_AIG_TOKEN` exists, requests add
`cf-aig-authorization: Bearer <token>`. The token is never returned verbatim by
the status handler.

## Request modes

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

For providers in the OpenAI-compatible Gateway subset, the chat handler shuffles
configured keys and creates one Compatibility Endpoint request per key. It sends
those requests in order until one succeeds, preserving credential fallback
without calling the deprecated Universal Endpoint. The model is rewritten to
`<provider>/<model>` for Gateway's compatibility endpoint.

### Universal Endpoint and compatibility pass-through

`POST /g/<gateway>/` accepts the repository's Universal Endpoint request shape,
validates provider names against the supported set, injects selected provider
headers, and forwards the mapped steps to Gateway's Universal Endpoint. This
explicit route remains available even though normal OpenAI-compatible chat uses
the Compatibility Endpoint. `POST /g/<gateway>/compat/chat/completions` forwards
directly to that fixed Gateway endpoint after stripping proxy credentials. No
other path under `/compat` is exposed.

## Maintenance risk

The supported-provider arrays in `src/ai_gateway/const.ts` are code, not dynamic
Gateway discovery. They must be checked against current Cloudflare documentation
when providers are added or Gateway behavior changes. Custom endpoint names are
not automatically Gateway-supported.

## References

- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway OpenAI-compatible endpoint](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/)
- [AI Gateway Universal Endpoint](https://developers.cloudflare.com/ai-gateway/usage/universal/)
- [AI Gateway provider endpoints](https://developers.cloudflare.com/ai-gateway/providers/)
