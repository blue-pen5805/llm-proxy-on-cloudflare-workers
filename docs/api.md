# HTTP API and Routing

All routes except CORS preflight pass through the same authentication layer.
Use `Authorization: Bearer <PROXY_API_KEY>` in normal clients. Responses from
upstream providers are streamed or forwarded without a proxy-specific envelope.

## Route summary

| Method    | Path                         | Purpose                                           |
| --------- | ---------------------------- | ------------------------------------------------- |
| `OPTIONS` | any                          | CORS preflight                                    |
| `GET`     | `/ping`                      | Lightweight liveness response (`Pong`)            |
| `GET`     | `/status`                    | Configuration and provider credential diagnostics |
| `POST`    | `/v1/chat/completions`       | OpenAI-compatible chat translation                |
| `GET`     | `/v1/models`                 | Best-effort aggregate model list                  |
| any       | `/<provider>/<path>`         | Provider pass-through                             |
| `POST`    | `/g/<gateway>/`              | AI Gateway Universal Endpoint                     |
| any       | `/g/<gateway>/compat/<path>` | AI Gateway compatibility pass-through             |

`/chat/completions` and `/models` are aliases of their `/v1` forms. Any normal
route may be prefixed with `/g/<gateway>` to choose a Gateway for that request,
and with `/key/<selection>` to select provider credentials. When both are used,
the key prefix comes first: `/key/1/g/team-gateway/v1/models`.

## Chat completions

The request body must be JSON with a provider-qualified model:

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

`GET /v1/models` queries every configured provider concurrently and prefixes
each returned ID with its route name. Each provider has a five-second timeout.
Failures are logged and omitted, so a successful response may be partial.

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
credential. Provider-specific request and response formats remain the caller's
responsibility. Routes are the keys registered in `src/providers.ts`; configured
custom endpoint names are added dynamically.

For cloud-platform pass-through, direct routes use the upstream provider path.
Bedrock paths beginning with `/v1` are automatically prefixed with
`bedrock-runtime/<region>` when routed through AI Gateway. Azure's classic
`/openai/deployments/<deployment>/...` path is similarly converted to Gateway's
`<resource>/<deployment>/...` form. Vertex pass-through is available only with
AI Gateway, and its provider-native path already matches the Gateway suffix.

## Explicit key selection

The prefix is zero-based and wraps a single index modulo the configured key
count:

| Prefix         | Selection                                     |
| -------------- | --------------------------------------------- |
| `/key/0/...`   | First key                                     |
| `/key/1-3/...` | Random key from inclusive indices 1 through 3 |
| `/key/2-/...`  | Random key from index 2 through the final key |
| `/key/-2/...`  | Random key from index 0 through 2             |

Do not use a key-selection prefix for a provider with no configured keys.

## Status and health

`/ping` proves only that the Worker can route a request. `/status` additionally
checks each configured credential against the provider's model-list endpoint and
returns `valid`, `invalid`, or `unknown`. Keys are masked, but the response
reveals configured providers, the last three characters of longer keys, default
model configuration, and AI Gateway identifiers. Keep it authenticated and do
not publish its output in support tickets without review.

Timeouts, unsupported model listing, and non-authentication HTTP failures are
reported as `unknown`. Authentication failures are `invalid`; unexpected fetch
errors currently also result in `invalid` after being logged.

## Errors

Known routing and authentication errors use JSON with an HTTP status. Unexpected
errors return a generic HTTP 500 response and details are written only to Worker
logs. Provider error bodies and status codes are normally forwarded as received.
