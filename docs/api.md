# HTTP API and Routing

All routes except CORS preflight pass through the same authentication layer.
Use `Authorization: Bearer <PROXY_API_KEY>` in normal clients. Anthropic SDKs
may use `x-api-key: <PROXY_API_KEY>` on the Anthropic-compatible API.
Browser preflight allows `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE`.
Cross-origin responses expose `X-Proxy-Models-Cache` and
`X-Proxy-Models-Truncated` to browser JavaScript.

Responses from upstream providers are streamed or forwarded without a
proxy-specific envelope, except for the opt-in additive `llm_proxy` metadata
documented by each compatibility API.

## API guides

- [OpenAI-compatible API](api/openai-compatible.md) covers Chat Completions,
  Responses, and Models.
- [Anthropic-compatible API](api/anthropic-compatible.md) covers Messages and
  the unsupported token-counting operation.
- [Provider pass-through API](api/provider-pass-through.md) covers direct and
  AI Gateway-backed provider-native requests.
- [AI Gateway API](api/ai-gateway.md) covers the Universal Endpoint, the
  account-level REST API proxy, and Gateway request metadata.
- [Proxy management API](api/proxy-management.md) covers liveness, provider
  status, and virtual-model inspection.

## Route summary

| Method                                          | Path                                   | Guide                                                              |
| ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `OPTIONS`                                       | any                                    | CORS preflight                                                     |
| `GET`, `HEAD`                                   | `/ping`                                | [Proxy management](api/proxy-management.md)                        |
| `GET`, `HEAD`                                   | `/status`                              | [Proxy management](api/proxy-management.md)                        |
| `GET`, `HEAD`                                   | `/virtual-models`                      | [Proxy management](api/proxy-management.md)                        |
| `POST`                                          | `/v1/chat/completions`                 | [OpenAI-compatible](api/openai-compatible.md#chat-completions)     |
| `POST`                                          | `/v1/responses`                        | [OpenAI-compatible](api/openai-compatible.md#responses)            |
| `POST`                                          | `/v1/messages`                         | [Anthropic-compatible](api/anthropic-compatible.md#messages)       |
| `POST`                                          | `/v1/messages/count_tokens`            | [Anthropic-compatible](api/anthropic-compatible.md#token-counting) |
| `GET`, `HEAD`                                   | `/v1/models`                           | [OpenAI-compatible](api/openai-compatible.md#models)               |
| `GET`, `HEAD`                                   | `/v1/models/<model>`                   | [OpenAI-compatible](api/openai-compatible.md#models)               |
| `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE` | `/<provider>[:<profile>]/<path>`       | [Provider pass-through](api/provider-pass-through.md)              |
| `POST`                                          | `/g/<gateway>/ai/run`                  | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/g/<gateway>/ai/v1/chat/completions`  | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/g/<gateway>/ai/v1/responses`         | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/g/<gateway>/ai/v1/messages`          | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/ai/run`                              | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/ai/v1/chat/completions`              | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/ai/v1/responses`                     | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/ai/v1/messages`                      | [AI Gateway](api/ai-gateway.md#rest-api)                           |
| `POST`                                          | `/g/<gateway>/`                        | [AI Gateway](api/ai-gateway.md#universal-endpoint)                 |
| `POST`                                          | `/`                                    | [AI Gateway](api/ai-gateway.md#universal-endpoint)                 |
| `POST`                                          | `/g/<gateway>/compat/chat/completions` | [AI Gateway](api/ai-gateway.md#compatibility-pass-through)         |
| `POST`                                          | `/compat/chat/completions`             | [AI Gateway](api/ai-gateway.md#compatibility-pass-through)         |

`/chat/completions`, `/responses`, `/messages`, and `/models` are aliases of
their `/v1` forms. `HEAD` follows the corresponding `GET` route and returns
identical status and headers with no response body.
Unprefixed AI Gateway REST, Universal Endpoint, and compatibility pass-through
routes require a Gateway context (`CLOUDFLARE_ACCOUNT_ID` plus a configured or
implicit `default` Gateway) and then use `AI_GATEWAY_NAME` or `default`.
Route matching ignores the query string except in the reserved AI Gateway REST
`/ai` namespace, where query-bearing variants return HTTP 404. Provider
pass-through retains allowed query parameters when forwarding upstream.

## Route prefixes

Supported compatibility, model, and provider pass-through routes may be
prefixed with `/g/<gateway>` to select an AI Gateway for that request. They may
also use `/key/<selection>` to select provider credentials. When both are used,
the key prefix comes first:

```text
/key/1/g/team-gateway/v1/models
```

Append `:<profile>` to a provider selector to use a named credential pool, for
example `openai:second/gpt-5.6-sol`. Omitting it selects `default`;
default-profile model IDs use `<provider>/<model>`. The selector works in model
IDs, provider pass-through paths, and as the Universal Endpoint `provider`
value. A missing or malformed named profile is rejected as an unknown provider
selector.

When `ALWAYS_USE_AI_GATEWAY=true`, every provider subrequest made by the
compatibility APIs, model discovery, status checks, or provider pass-through
routing uses AI Gateway. The configured `AI_GATEWAY_NAME` is selected
automatically; when it is absent, the Gateway name is `default`. An explicit
`/g/<gateway>` prefix overrides it. Native Gateway provider routes are
preferred, while unsupported operations use the managed
`custom-llm-proxy-<provider>` provider segment. Strict mode never silently
falls back to the direct Base URL.

### Explicit key selection

The prefix is zero-based and wraps a single index modulo the configured key
count. Indices must be non-negative safe integers; reversed or malformed ranges
return HTTP 400:

| Prefix         | Selection                                     |
| -------------- | --------------------------------------------- |
| `/key/0/...`   | First key                                     |
| `/key/1-3/...` | Random key from inclusive indices 1 through 3 |
| `/key/2-/...`  | Random key from index 2 through the final key |
| `/key/-2/...`  | Random key from index 0 through 2             |

Do not use a key-selection prefix for a provider with no configured keys. The
prefix is not supported by `/ping`, `/status`, `/virtual-models`, AI Gateway
REST or legacy compatibility pass-through routes, the Universal Endpoint, or
unknown routes; those combinations return HTTP 400 instead of ignoring the
selection.

For OpenAI-compatible chat through AI Gateway, an explicit index or range sends
only the resolved credential and does not fall back to another configured key.
Without an explicit selection, the Worker tries the slot chosen by striped
per-isolate rotation first and may then try shuffled remaining keys, up to four
total attempts, after a network error, HTTP 401/403, or HTTP 429.

## Common errors

| Route family                                                              | JSON contract                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| OpenAI-compatible routes, routing, authentication, and proxy-local errors | `{ "error": { "message", "type", "param", "code" } }`  |
| Anthropic-compatible routes                                               | `{ "type": "error", "error": { "type", "message" } }`  |
| Provider and AI Gateway pass-through                                      | Upstream body/status unless rejected before forwarding |
| Streaming conversion failures                                             | Protocol-specific terminal SSE error event             |

Unexpected errors use the applicable local envelope with a generic HTTP 500
message; details are written only to Worker logs. Requests whose decoded body
exceeds 10 MiB return HTTP 413 before JSON parsing, including Responses and
Messages requests. Proxy-issued HTTP 401 responses carry
`WWW-Authenticate: Bearer` without a realm. An upstream 401 forwarded from a
provider keeps that provider's own headers.
Unknown client provider selectors are HTTP 400 on compatibility routes. A
registered provider that lacks required operator configuration returns HTTP 503.
