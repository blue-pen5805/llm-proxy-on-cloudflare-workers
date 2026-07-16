# Cloudflare AI Gateway Integration

## Goals and boundary

The Worker can route supported provider traffic through Cloudflare AI Gateway
without changing its public authentication contract. Gateway performs its own
logging, analytics, caching, retry, or fallback behavior according to the
operator's Gateway configuration; the Worker is responsible for constructing
Gateway URLs, headers, and Universal Endpoint payloads.

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

### OpenAI-compatible chat

For providers in the OpenAI-compatible Gateway subset, the chat handler builds
a Universal Endpoint request containing `compat` steps. It shuffles configured
keys and creates one step per key, allowing Gateway to attempt the generated
sequence. The model is rewritten to `<provider>/<model>` for Gateway's
compatibility endpoint.

### Universal Endpoint and compatibility pass-through

`POST /g/<gateway>/` accepts the repository's Universal Endpoint request shape,
validates provider names against the supported set, injects selected provider
headers, and forwards the mapped steps to Gateway. `/g/<gateway>/compat/...`
forwards directly to the Gateway compatibility path after stripping proxy
credentials.

## Maintenance risk

The supported-provider arrays in `src/ai_gateway/const.ts` are code, not dynamic
Gateway discovery. They must be checked against current Cloudflare documentation
when providers are added or Gateway behavior changes. Custom endpoint names are
not automatically Gateway-supported.

## References

- [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway Universal Endpoint](https://developers.cloudflare.com/ai-gateway/providers/universal/)
- [AI Gateway provider endpoints](https://developers.cloudflare.com/ai-gateway/providers/)
