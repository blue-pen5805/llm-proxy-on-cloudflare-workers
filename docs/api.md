# HTTP API and Routing

All routes except CORS preflight pass through the same authentication layer.
Use `Authorization: Bearer <PROXY_API_KEY>` in normal clients. Responses from
upstream providers are streamed or forwarded without a proxy-specific envelope,
except for the opt-in additive `llm_proxy` metadata on routed
OpenAI-compatible Chat Completions and converted Responses or Messages output.

## Route summary

| Method        | Path                                   | Purpose                                           |
| ------------- | -------------------------------------- | ------------------------------------------------- |
| `OPTIONS`     | any                                    | CORS preflight                                    |
| `GET`, `HEAD` | `/ping`                                | Lightweight liveness response (`Pong` for `GET`)  |
| `GET`, `HEAD` | `/status`                              | Configuration and provider credential diagnostics |
| `GET`, `HEAD` | `/virtual-models`                      | Virtual models and ordered failover candidates    |
| `POST`        | `/v1/chat/completions`                 | OpenAI-compatible chat translation                |
| `POST`        | `/v1/responses`                        | Experimental Responses-to-Chat conversion         |
| `POST`        | `/v1/messages`                         | Experimental Messages-to-Chat conversion          |
| `POST`        | `/v1/messages/count_tokens`            | Explicit unsupported-operation error              |
| `GET`, `HEAD` | `/v1/models`                           | Best-effort aggregate model list                  |
| `GET`, `HEAD` | `/v1/models/<model>`                   | Retrieve one aggregated model                     |
| any           | `/<provider>[:<profile>]/<path>`       | Provider pass-through                             |
| `POST`        | `/g/<gateway>/ai/run`                  | AI Gateway REST API: Workers AI native format     |
| `POST`        | `/g/<gateway>/ai/v1/chat/completions`  | AI Gateway REST API: Chat Completions             |
| `POST`        | `/g/<gateway>/ai/v1/responses`         | AI Gateway REST API: Responses                    |
| `POST`        | `/g/<gateway>/ai/v1/messages`          | AI Gateway REST API: Messages                     |
| `POST`        | `/g/<gateway>/`                        | AI Gateway Universal Endpoint                     |
| `POST`        | `/g/<gateway>/compat/chat/completions` | AI Gateway compatibility pass-through             |

`/chat/completions`, `/responses`, `/messages`, and `/models` are aliases of
their `/v1` forms. Supported routes may be prefixed with `/g/<gateway>` to
choose a Gateway for that request. OpenAI-compatible chat, Responses,
Anthropic-compatible Messages, models, and registered provider pass-through
routes may also use `/key/<selection>` to select provider credentials. When
both are used, the key prefix comes first: `/key/1/g/team-gateway/v1/models`.
`HEAD` follows the corresponding `GET` route and returns identical status and
headers with no response body.

When `ALWAYS_USE_AI_GATEWAY=true`, every provider subrequest made by chat,
Responses, Messages, models, status, or provider pass-through routing uses AI
Gateway. The configured `AI_GATEWAY_NAME` is selected automatically; when it is
absent, the Gateway name is `default`. An explicit `/g/<gateway>` prefix
overrides it. Native Gateway provider routes are preferred, while unsupported
operations use the managed `custom-llm-proxy-<provider>` provider segment.
Strict mode never silently falls back to the direct Base URL.

The Universal Endpoint body must be a non-empty JSON array with at most
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

Append `:<profile>` to select a named provider credential pool, for example
`openai:second/gpt-5.6-sol`. Omitting it selects `default`; default-profile
model IDs use `<provider>/<model>`. The same selector works in pass-through
paths and as the Universal Endpoint `provider` value. A missing or malformed
named profile is rejected as an unknown provider selector.

A `model` that does not name a real provider can select an operator-defined
virtual model. Its candidates run in order under their normal provider routing
and key policies. See [Configuration](configuration.md#virtual-models) for the
declaration format and [Virtual models design](design/features/virtual_models.md)
for retry semantics.

The adapters retain only parameters supported by each upstream API. Translation
is therefore OpenAI-compatible at the endpoint level, not a guarantee that every
OpenAI field or provider feature has identical semantics.

`CHAT_RESPONSE_METADATA_ENABLED=true` adds a top-level `llm_proxy` object after
a concrete route is selected. It reports routing, credential slot, Gateway,
request ID, and timing metadata without credential material. Streaming output
adds one empty-choice metadata chunk before `[DONE]`. The feature defaults to
`false`; bodies that cannot be safely transformed remain unchanged. See the
[metadata contract](design/features/provider_abstraction.md#compatibility-response-metadata).

## Responses

The proxy's Responses compatibility API is experimental and limited to the
fields, output mapping, and streaming events documented in this section.

`POST /v1/responses` and its `/responses` alias accept an OpenAI Responses
request with the same provider-qualified `model` used by Chat Completions:

```bash
curl https://your-worker.example/v1/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.4",
    "instructions": "Answer concisely.",
    "input": "Why is the sky blue?",
    "stream": true
  }'
```

The Worker converts `instructions`, string or message-item `input`, image URLs,
uploaded-file IDs or base64 files, function and custom tool calls and outputs,
function and custom tool definitions, named or allowed tool choice,
structured-output format, verbosity, reasoning effort, token limits, sampling
fields, metadata, and streaming controls to Chat Completions. It then runs the
ordinary Chat Completions path, including real and virtual models, provider
parameter filtering, credential profiles, key rotation/cooldown,
`/key/<selection>`, and direct or AI Gateway routing. This makes the route
available to every provider whose Chat Completions adapter supports the
resulting fields.

Successful Chat Completions JSON is converted into a Responses object with
typed message, function-call, and custom-tool-call output items and Responses
token-usage names. With `stream: true`, Chat Completions chunks are converted
incrementally into typed Responses SSE events, including text, function-call
argument, and custom-tool input deltas, completed output items, and a final
`response.completed` or `response.incomplete` event. The conversion remains
streaming and propagates client cancellation. Upstream error responses retain
their status and error body.

Converted streams enforce bounded records, retained content, tool calls, and
output items. Malformed, oversized, or truncated streams emit a terminal error,
omit the success event, and cancel the upstream stream. Exact mappings and
limits are defined in the
[Responses compatibility design](design/features/responses-api.md).

When `CHAT_RESPONSE_METADATA_ENABLED=true`, converted JSON includes the same
top-level `llm_proxy` routing and timing object as Chat Completions. Streaming
output includes it in the final `response.completed` or
`response.incomplete` event's `response`; it is not exposed as a Chat chunk.

The proxy has no conversation store or built-in tool executor. Top-level
Responses request fields without a supported Chat Completions conversion are
ignored and not forwarded: `background`, `context_management`, `conversation`,
`include`, `max_tool_calls`, `moderation`, `previous_response_id`, `prompt`,
`prompt_cache_key`, `prompt_cache_options`, `prompt_cache_retention`,
`safety_identifier`, `stream_options`, and `truncation`. Built-in storage,
built-in tools, file URLs, non-text tool-output parts, unsupported nested input,
text, or tool options, and unknown request fields still return HTTP 400.
Members of the `reasoning` object other than `effort`, including `summary`,
`context`, and future options, are ignored rather than forwarded.

## Messages

The proxy's Anthropic Messages compatibility API is experimental and limited to
the fields and converted JSON/SSE events documented in this section.

`POST /v1/messages` and its `/messages` alias accept an Anthropic Messages body
whose `model` uses the same provider-qualified selector as Chat Completions:

```bash
curl https://your-worker.example/v1/messages \
  --header "x-api-key: $PROXY_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "Content-Type: application/json" \
  --data '{
    "model": "openai/gpt-5.4",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Why is the sky blue?"}],
    "stream": true
  }'
```

The Worker converts text, base64 or URL images, system prompts, `tool_use` and
`tool_result` blocks, custom tools and tool choice, stop sequences, token and
sampling controls, streaming, and `metadata.user_id` to Chat Completions. It
then uses the normal provider, virtual-model, credential-profile, key rotation,
cooldown, `/key/...`, and AI Gateway path.

Successful Chat JSON becomes an Anthropic message with `text` and `tool_use`
content blocks, Anthropic stop reasons, and token usage. Streaming Chat chunks
become `message_*` and `content_block_*` SSE events without buffering the whole
response. Upstream errors retain their original status and body. With
`CHAT_RESPONSE_METADATA_ENABLED=true`, JSON includes `llm_proxy`, while a
stream includes it on the final `message_delta` event.

Text deltas stream incrementally; tool blocks are emitted sequentially after
the text block because Anthropic content blocks cannot interleave. Malformed,
oversized, or truncated streams emit a terminal error, omit `message_stop`, and
cancel the upstream stream.

Unknown fields and features without a direct Chat equivalent—including
documents, citations, cache controls, thinking, server tools, MCP, containers,
and context management—return HTTP 400. Use `/anthropic/v1/messages` when the
complete provider-native contract is required. Exact mappings and limits are in
the [Messages compatibility design](design/features/messages-api.md).

`POST /v1/messages/count_tokens` returns an Anthropic-shaped HTTP 400 error.
Token counting is not approximated because Chat Completions has no equivalent
operation that preserves Anthropic tokenization.

## Models

`GET /v1/models` queries configured providers and prefixes each returned ID
with its route selector. Default-profile IDs use `<provider>/<model>` and
named-profile IDs use `<provider>:<profile>/<model>`. When `VIRTUAL_MODELS` is configured, every virtual model is
listed first — ahead of the provider models — with `owned_by: "virtual"`, so
clients discover them at the front of the list. All configured providers are
queried concurrently, each with a 60-second timeout and 1 MiB response limit. At most 1,000 models
per provider and 4 MiB of serialized model entries are retained. A bounded
aggregate includes `X-Proxy-Models-Truncated: true` when it is truncated.
Non-successful upstream responses are discarded before provider-specific model
conversion. Failures are logged and omitted, so a successful response may be
partial.

`?provider=openai,anthropic` restricts aggregation to the named registered
providers. The normalized provider set is part of the cache key. Unknown,
empty, repeated, or excessive filters return HTTP 400. `GET
/v1/models/<model>` selects an exact provider-qualified or virtual model ID
from the same aggregate and returns `model_not_found` when absent.

Successful complete aggregates are cached for `MODELS_CACHE_TTL_SECONDS`
(default 300, `0` disables) per gateway and key selection, and served with
`X-Proxy-Models-Cache: HIT` or `MISS`. Partial or truncated aggregates are
served but never cached. `Cache-Control: no-cache` on the request skips the
cached copy and refreshes it; `Cache-Control: no-store` or any `cf-aig-*`
request header bypasses the cache entirely, and bypassed responses carry no
cache header. The cache is per Cloudflare datacenter, so a configuration
change can serve a stale list from an already-primed datacenter for up to the
TTL. Cache API `open`, `match`, and `put` are optional optimizations: if an
operation fails, the request continues with an uncached provider fan-out. The
cache is ineffective on a `*.workers.dev` deployment; use a custom domain to
enable it.
Client-facing model responses always carry `Cache-Control: private, no-store`;
the public max-age used by the internal Cache API is never exposed.

Custom endpoints should use a static `models` list when reliable discovery
matters. Model discovery uses the first provider key by default. Bedrock and
Azure OpenAI are omitted unless their required local credentials and routing
settings are configured, including in strict Gateway mode.

## Virtual models

`GET /virtual-models` returns the configured virtual models without making
provider subrequests. Its top-level `{ "object": "list", "data": [...] }`
shape and each item's `id`, `object`, `created`, and `owned_by` fields match the
virtual-model entries returned by `GET /models`. The additional `access_order`
array contains the Virtual Model-specific routing details in the same order as
`VIRTUAL_MODELS`. `position` is one-based, `retries` is the number of additional
attempts, and `attempts` is the resulting maximum number of times that candidate
can be entered before failover. `timeout_ms` appears only when a response-header
timeout is configured.

```json
{
  "object": "list",
  "data": [
    {
      "id": "virtual/reliable",
      "object": "model",
      "created": 0,
      "owned_by": "virtual",
      "access_order": [
        {
          "position": 1,
          "model": "openai/gpt-4o-mini",
          "retries": 1,
          "attempts": 2,
          "timeout_ms": 5000
        }
      ]
    }
  ]
}
```

Nested virtual-model references are expanded recursively into an `access_order`
on the referencing candidate. The reference candidate remains in the response,
so its retries and timeout still describe the boundary around the complete
nested chain. A virtual-model key shadowed by a real provider is not expanded,
matching runtime provider precedence. An unconfigured deployment returns an
empty `data` array. Invalid `VIRTUAL_MODELS` configuration fails with the same
HTTP 503 as chat and model discovery. The route uses normal proxy
authentication, does not support `/key/<selection>`, and accepts
`/g/<gateway>/virtual-models` without changing the response.

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
`True-Client-IP` is never forwarded. Retained query parameters are passed
through byte-for-byte, including empty fields. Path `.` and `..` segments are
rejected; matching text inside a query value is preserved.

All outbound requests use manual redirect handling, so the Worker never follows
a redirect with credentials attached. Pass-through routes return upstream 3xx
responses unchanged; clients must not replay the proxy credential when following
them.
Request-level `cf-aig-*` control headers are forwarded when the selected route
uses AI Gateway and removed on direct provider requests. Client
`cf-aig-authorization`, `cf-aig-byok-alias`, and `cf-aig-cache-key` are always
removed; Gateway authentication, stored-credential selection, and cache
partitioning remain operator-controlled.
Provider-specific request and response formats remain the caller's
responsibility. Routes are the keys registered in `src/providers.ts`; configured
custom endpoint names are added dynamically.

In strict Gateway mode, pass-through paths for a managed Custom Provider retain
the configured upstream path semantics. Direct pass-through keeps the
configured Base URL unchanged. See
[Custom Provider path behavior](design/features/ai_gateway.md#custom-provider-path-behavior).

For cloud-platform pass-through, direct routes use the upstream provider path.
Bedrock paths beginning with `/v1` are automatically prefixed with
`bedrock-runtime/<region>` when routed through AI Gateway. Azure's classic
`/openai/deployments/<deployment>/...` path is similarly converted to Gateway's
`<resource>/<deployment>/...` form. Vertex pass-through is available only with
AI Gateway, and its provider-native path already matches the Gateway suffix.

## AI Gateway request metadata

Resolved Chat Completions, Responses, Messages, provider pass-through, and
Universal Endpoint requests routed through AI Gateway add proxy-owned fields to
`cf-aig-metadata` when space remains, in the following priority order:

- `llm_proxy_virtual_model`: outer client-requested virtual model, when used;
- `llm_proxy_endpoint`: public proxy operation, such as `chat_completions`,
  `responses`, `messages`, `provider_proxy`, or `universal_endpoint`;
- `llm_proxy_provider`: resolved provider;
- `llm_proxy_model`: resolved concrete model;
- `llm_proxy_credentials`: selected credential as
  `<credential-profile>:<provider-key-index>`, for example `default:0` or
  `paid:1`. The index is `null` when Gateway BYOK supplies the key, such as
  `default:null`.

Universal Endpoint requests omit `llm_proxy_credentials` because separate
steps can use different credentials. Client metadata wins on key collisions;
the proxy preserves invalid client JSON unchanged and never adds credential
values or proxy-authentication key slots. Cloudflare stores at most five
metadata entries, so client entries can leave insufficient room for later
proxy fields.

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
  --data '{"model":"openai/gpt-5.6-sol","input":"Hello"}'
```

Other methods and paths under `/ai` are rejected rather than forwarded.
Third-party models use `<provider>/<model>`; Workers AI models use
`@cf/<author>/<model>`. The Messages route does not support Workers AI.
Client `cf-aig-*` control headers are forwarded, allowing retry, cache, cost,
log, and metadata settings to override Gateway defaults for that request.
Client `cf-aig-authorization`, `cf-aig-byok-alias`, and `cf-aig-cache-key` are
always removed. A configured `CF_AIG_TOKEN`, REST API authorization, and the
route-selected Gateway ID are applied by the Worker after client header
processing and therefore take precedence where applicable.

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
The prefix is not supported by `/ping`, `/status`, `/virtual-models`, AI Gateway
REST or legacy compatibility pass-through routes, the Universal Endpoint, or
unknown routes; those combinations return HTTP 400 instead of ignoring the
selection.

For OpenAI-compatible chat through AI Gateway, an explicit index or range sends
only the resolved credential and does not fall back to another configured key.
Without an explicit selection, the Worker tries the slot chosen by striped
per-isolate rotation first and may then try shuffled remaining keys, up to four total attempts,
after a network error, HTTP 401/403, or HTTP 429.

## Status and health

`/ping` proves only that the Worker can route a request. `/status` additionally
checks every configured credential against provider model-list endpoints
concurrently, without an application-level concurrency cap, and returns
`valid`, `invalid`, or `unknown`. No key value or suffix is returned, but the
response reveals configured providers, credential slot counts, default model
configuration, and AI Gateway identifiers. Keep it authenticated and do not
publish its output in support tickets without review. The response body uses
compact JSON without indentation or line breaks.
All proxy-generated health and diagnostic responses carry `Cache-Control:
no-store`. When `STATUS_CACHE_TTL_SECONDS` is positive, `/status` reuses an
internal per-datacenter result and reports `HIT` or `MISS` in
`X-Proxy-Status-Cache`; request `no-cache` refreshes it and `no-store` bypasses
it.

Timeouts, unsupported model listing, and non-authentication HTTP failures are
reported as `unknown`. Authentication failures and unexpected fetch errors are
`invalid`; unexpected fetch errors are also logged.

The check count follows the deployed credential count and can exhaust the
per-request subrequest budget. After authentication, provider and check failures
remain isolated: unexamined slots stay `unknown`, and providers that cannot be
described report `available: false` with no key slots.

## Errors

| Route family                                                              | JSON contract                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| OpenAI-compatible routes, routing, authentication, and proxy-local errors | `{ "error": { "message", "type", "param", "code" } }`  |
| Messages compatibility, including `count_tokens`                          | `{ "type": "error", "error": { "type", "message" } }`  |
| Provider and AI Gateway pass-through                                      | Upstream body/status unless rejected before forwarding |
| Streaming conversion failures                                             | Protocol-specific terminal SSE error event             |

Unexpected errors use the applicable local envelope with a generic HTTP 500
message; details are written only to Worker logs.
Requests whose decoded body exceeds 10 MiB return HTTP 413 before JSON parsing,
including Responses and Messages requests.
Proxy-issued HTTP 401 responses carry `WWW-Authenticate: Bearer` without a
realm. An upstream 401 forwarded from a provider keeps that provider's own
headers.
