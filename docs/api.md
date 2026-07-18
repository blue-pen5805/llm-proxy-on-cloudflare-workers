# HTTP API and Routing

All routes except CORS preflight pass through the same authentication layer.
Use `Authorization: Bearer <PROXY_API_KEY>` in normal clients. Responses from
upstream providers are streamed or forwarded without a proxy-specific envelope.

## Route summary

| Method    | Path                                   | Purpose                                           |
| --------- | -------------------------------------- | ------------------------------------------------- |
| `OPTIONS` | any                                    | CORS preflight                                    |
| `GET`     | `/ping`                                | Lightweight liveness response (`Pong`)            |
| `GET`     | `/status`                              | Configuration and provider credential diagnostics |
| `POST`    | `/v1/chat/completions`                 | OpenAI-compatible chat translation                |
| `GET`     | `/v1/models`                           | Best-effort aggregate model list                  |
| any       | `/<provider>/<path>`                   | Provider pass-through                             |
| `POST`    | `/g/<gateway>/ai/run`                  | AI Gateway REST API: Workers AI native format     |
| `POST`    | `/g/<gateway>/ai/v1/chat/completions`  | AI Gateway REST API: Chat Completions             |
| `POST`    | `/g/<gateway>/ai/v1/responses`         | AI Gateway REST API: Responses                    |
| `POST`    | `/g/<gateway>/ai/v1/messages`          | AI Gateway REST API: Messages                     |
| `POST`    | `/g/<gateway>/`                        | Legacy AI Gateway Universal Endpoint              |
| `POST`    | `/g/<gateway>/compat/chat/completions` | Legacy AI Gateway compatibility pass-through      |

`/chat/completions` and `/models` are aliases of their `/v1` forms. Supported
routes may be prefixed with `/g/<gateway>` to choose a Gateway for that request.
OpenAI-compatible chat, models, and registered provider pass-through routes may
also use `/key/<selection>` to select provider credentials. When both are used,
the key prefix comes first: `/key/1/g/team-gateway/v1/models`.

The legacy Universal Endpoint body must be a non-empty JSON array with at most
16 steps. Each step needs a supported `provider` and an object-valued `query`.
Client-provided authentication headers cannot override the configured provider
credential. A custom step `endpoint` is normalized to a relative path, limited
to 2,048 characters, and cannot contain a URL scheme, backslash, control
character, or `.`/`..` path segment.

## Chat completions

The request body must be JSON with a provider-qualified model and is limited to
10 MiB:

```bash
curl https://your-worker.example/v1/chat/completions \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

The first segment identifies the provider; the remaining string is sent as the
upstream model, so model IDs containing `/` are supported. `model: "default"`
uses `DEFAULT_MODEL`. Invalid JSON, a missing model, an unknown provider, or a
missing default returns HTTP 400.

The adapters retain only parameters supported by each upstream API. Translation
is therefore OpenAI-compatible at the endpoint level, not a guarantee that every
OpenAI field or provider feature has identical semantics.

Cloud-platform model examples are `azure-openai/<deployment-name>`,
`google-vertex-ai/google/<gemini-model>`, and
`aws-bedrock/<inference-profile-or-model-id>`. Azure sends the deployment name
as `model` to the Azure OpenAI v1 API. Bedrock uses its native OpenAI-compatible
endpoint. Vertex chat is sent only through AI Gateway using the configured
service-account JSON; direct requests are rejected with HTTP 400. Vertex model
discovery is not available through the compatibility API and is therefore
omitted from `/v1/models`.

## Models

`GET /v1/models` queries configured providers and prefixes each returned ID
with its route name. Providers are queried five at a time and
each has a five-second timeout and 1 MiB response limit. At most 1,000 models
per provider and 4 MiB of serialized model entries are retained. A bounded
aggregate includes `X-Proxy-Models-Truncated: true` when it is truncated.
Non-successful upstream responses are discarded before provider-specific model
conversion. Failures are logged and omitted, so a successful response may be
partial.

Custom endpoints should define a static `models` list when reliable discovery
matters. The endpoint uses the first provider key by default to avoid advancing
key rotation merely for discovery.

## Provider pass-through

A pass-through request removes the provider prefix and forwards the remaining
method, body, query string, and non-proxy headers:

```bash
curl https://your-worker.example/openai/v1/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"model":"gpt-4o-mini","input":"Hello"}'
```

The proxy replaces client authentication headers with the selected upstream
credential. It also removes cookies, hop-by-hop headers, client/network metadata,
and credential-like query parameters, including API-key variants,
`access_token`, `token`, `authorization`, `auth`, `password`, and `secret`.
Request-level `cf-aig-*` control headers are forwarded when the selected route
uses AI Gateway and removed on direct provider requests. Client
`cf-aig-authorization` and `cf-aig-byok-alias` are always removed; Gateway
authentication and stored-credential selection remain operator-controlled.
Provider-specific request and response formats remain the caller's
responsibility. Routes are the keys registered in `src/providers.ts`; configured
custom endpoint names are added dynamically.

For cloud-platform pass-through, direct routes use the upstream provider path.
Bedrock paths beginning with `/v1` are automatically prefixed with
`bedrock-runtime/<region>` when routed through AI Gateway. Azure's classic
`/openai/deployments/<deployment>/...` path is similarly converted to Gateway's
`<resource>/<deployment>/...` form. Vertex pass-through is available only with
AI Gateway, and its provider-native path already matches the Gateway suffix.

## AI Gateway REST API

The proxy exposes Cloudflare's account-level AI Gateway REST API through exactly
four fixed routes. Use the `/g/<gateway>` prefix when selecting the Gateway in
the request:

- `POST /g/<gateway>/ai/run`
- `POST /g/<gateway>/ai/v1/chat/completions`
- `POST /g/<gateway>/ai/v1/responses`
- `POST /g/<gateway>/ai/v1/messages`

Configure both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The Worker
forwards the request and response streams without translating their bodies,
replaces the client authentication header with the Cloudflare API token, and
sets `cf-aig-gateway-id` to the selected Gateway. The unprefixed `/ai/...`
forms are shortcuts for the configured `AI_GATEWAY_NAME`. When no default
Gateway is configured, use the explicit `/g/<gateway>/ai/...` form.

```bash
curl https://your-worker.example/g/production/ai/v1/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"model":"openai/gpt-5.4","input":"Hello"}'
```

Other methods and paths under `/ai` are rejected rather than forwarded.
Third-party models use `<provider>/<model>`; Workers AI models use
`@cf/<author>/<model>`. The Messages route does not support Workers AI.
Client `cf-aig-*` control headers are forwarded, allowing retry, cache, cost,
log, and metadata settings to override Gateway defaults for that request.
Client `cf-aig-authorization` and `cf-aig-byok-alias` are always removed. A
configured `CF_AIG_TOKEN`, REST API authorization, and the route-selected
Gateway ID are applied by the Worker after client header processing and
therefore take precedence where applicable.

## Explicit key selection

The prefix is zero-based and wraps a single index modulo the configured key
count. Indices must be non-negative safe integers; reversed or malformed ranges
return HTTP 400:

| Prefix         | Selection                                     |
| -------------- | --------------------------------------------- |
| `/key/0/...`   | First key                                     |
| `/key/1-3/...` | Random key from inclusive indices 1 through 3 |
| `/key/2-/...`  | Random key from index 2 through the final key |
| `/key/-2/...`  | Random key from index 0 through 2             |

Do not use a key-selection prefix for a provider with no configured keys.
The prefix is not supported by `/ping`, `/status`, AI Gateway REST or legacy
compatibility pass-through routes, the Universal Endpoint, or unknown routes;
those combinations return HTTP 400 instead of ignoring the selection.

For OpenAI-compatible chat through AI Gateway, an explicit index or range sends
only the resolved credential and does not fall back to another configured key.
Without an explicit selection, the Worker tries the random or globally rotated
slot first and may then try shuffled remaining keys, up to four total attempts,
after a network error, HTTP 401/403, or HTTP 429.

## Status and health

`/ping` proves only that the Worker can route a request. `/status` additionally
checks up to 32 configured credentials against provider model-list endpoints,
five at a time, and returns `valid`, `invalid`, or `unknown`. Additional slots
remain `unknown`. No key value or suffix is returned, but the response reveals
configured providers, credential slot counts, default model configuration, and
AI Gateway identifiers. Keep it authenticated and do not publish its output in
support tickets without review.

Timeouts, unsupported model listing, and non-authentication HTTP failures are
reported as `unknown`. Authentication failures are `invalid`; unexpected fetch
errors currently also result in `invalid` after being logged.

## Errors

Known routing and authentication errors use JSON with an HTTP status. Unexpected
errors return a generic HTTP 500 response and details are written only to Worker
logs. Provider error bodies and status codes are normally forwarded as received.
