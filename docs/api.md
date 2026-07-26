# HTTP API and Routing

All routes except CORS preflight pass through the same authentication layer.
Use `Authorization: Bearer <PROXY_API_KEY>` in normal clients. Responses from
upstream providers are streamed or forwarded without a proxy-specific envelope,
except for the opt-in additive `llm_proxy` metadata on routed
OpenAI-compatible Chat Completions and converted Responses or Messages output.

## Route summary

| Method    | Path                                   | Purpose                                           |
| --------- | -------------------------------------- | ------------------------------------------------- |
| `OPTIONS` | any                                    | CORS preflight                                    |
| `GET`     | `/ping`                                | Lightweight liveness response (`Pong`)            |
| `GET`     | `/status`                              | Configuration and provider credential diagnostics |
| `GET`     | `/virtual-models`                      | Virtual models and ordered failover candidates    |
| `POST`    | `/v1/chat/completions`                 | OpenAI-compatible chat translation                |
| `POST`    | `/v1/responses`                        | Experimental Responses-to-Chat conversion         |
| `POST`    | `/v1/messages`                         | Experimental Messages-to-Chat conversion          |
| `GET`     | `/v1/models`                           | Best-effort aggregate model list                  |
| any       | `/<provider>[:<profile>]/<path>`       | Provider pass-through                             |
| `POST`    | `/g/<gateway>/ai/run`                  | AI Gateway REST API: Workers AI native format     |
| `POST`    | `/g/<gateway>/ai/v1/chat/completions`  | AI Gateway REST API: Chat Completions             |
| `POST`    | `/g/<gateway>/ai/v1/responses`         | AI Gateway REST API: Responses                    |
| `POST`    | `/g/<gateway>/ai/v1/messages`          | AI Gateway REST API: Messages                     |
| `POST`    | `/g/<gateway>/`                        | AI Gateway Universal Endpoint                     |
| `POST`    | `/g/<gateway>/compat/chat/completions` | AI Gateway compatibility pass-through             |

`/chat/completions`, `/responses`, `/messages`, and `/models` are aliases of
their `/v1` forms. Supported routes may be prefixed with `/g/<gateway>` to
choose a Gateway for that request. OpenAI-compatible chat, Responses,
Anthropic-compatible Messages, models, and registered provider pass-through
routes may also use `/key/<selection>` to select provider credentials. When
both are used, the key prefix comes first: `/key/1/g/team-gateway/v1/models`.

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

A `model` that does not name a real provider but matches a key in
`VIRTUAL_MODELS` selects an operator-defined
[virtual model](design/features/virtual_models.md) (`"virtual/<name>"` is the
recommended convention, but any key works; real providers take precedence):
candidates from `VIRTUAL_MODELS` are tried in order, and the first non-retryable
response (or the last candidate's response) is returned as-is. A candidate can
be a bare model string or an object with `model`, `retries`, and `timeout`;
`retries` adds up to five attempts before advancing, while `timeout` limits the
wait for response headers in milliseconds. Each attempt applies the normal
striped per-isolate round-robin or explicit key-selection policy. A candidate
may reference another configured virtual model; references are recursive and
must form an acyclic graph whose expanded chain stays within 96 concrete
provider attempts. An undefined
virtual model name returns the same HTTP 400 `"Invalid provider."` as an
unknown provider.

The adapters retain only parameters supported by each upstream API. Translation
is therefore OpenAI-compatible at the endpoint level, not a guarantee that every
OpenAI field or provider feature has identical semantics.

When `CHAT_RESPONSE_METADATA_ENABLED=true`, object-valued JSON responses include
an additive top-level `llm_proxy` object after a concrete upstream route is
selected, including upstream JSON errors. It identifies the concrete `provider`
and `model`, the resolved
`requested_model`, credential profile and zero-based configured credential slot,
AI Gateway route, request ID, and request timing. `credential_index` is omitted
when AI Gateway supplies a credential; `gateway` is omitted for direct requests.
No credential value or derived identifier is exposed. For example:

```json
{
  "id": "chatcmpl-example",
  "object": "chat.completion",
  "choices": [],
  "llm_proxy": {
    "request_id": "example-request-id",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "requested_model": "virtual/fast",
    "credential_profile": "default",
    "credential_index": 0,
    "via_ai_gateway": true,
    "gateway": "production",
    "started_at": "2026-07-22T00:00:00.000Z",
    "headers_received_ms": 184.27,
    "completed_at": "2026-07-22T00:00:00.190Z",
    "duration_ms": 190.14
  }
}
```

With `"stream": true`, provider SSE chunks pass through unchanged and one additional
`chat.completion.chunk` with `choices: []` and `llm_proxy` is emitted immediately
before `data: [DONE]`. Its `duration_ms` measures through stream completion;
`headers_received_ms` measures time to the selected upstream response headers.
Clients that strictly enumerate chunks should accept or ignore an empty-choice
metadata chunk. A JSON body is parsed only up to 5 MiB; malformed, oversized,
non-object, and non-JSON upstream responses are returned unchanged. Local errors
that occur before provider selection do not include the extension. See
[the response metadata design](design/features/chat-response-metadata.md).

The setting defaults to `false`. When disabled, the response body and stream are
not inspected or rewritten by this metadata feature, preserving strict OpenAI
client compatibility.

Cloud-platform model examples are `azure-openai/<deployment-name>`,
`google-vertex-ai/google/<gemini-model>`, and
`aws-bedrock/<inference-profile-or-model-id>`. Azure sends the deployment name
as `model` to the Azure OpenAI v1 API. Bedrock uses its native OpenAI-compatible
endpoint. Vertex chat is sent only through AI Gateway using the configured
service-account JSON; direct requests are rejected with HTTP 400. Vertex model
discovery is not available through the compatibility API and is therefore
omitted from `/v1/models`.

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
function calls and outputs, function tools, tool choice, structured-output
format, reasoning effort, token limits, sampling fields, metadata, and streaming
controls to Chat Completions. It then runs the ordinary Chat Completions path,
including real and virtual models, provider parameter filtering, credential
profiles, key rotation/cooldown, `/key/<selection>`, and direct or AI Gateway
routing. This makes the route available to every provider whose Chat
Completions adapter supports the resulting fields.

Successful Chat Completions JSON is converted into a Responses object with
typed message and function-call output items and Responses token-usage names.
With `stream: true`, Chat Completions chunks are converted incrementally into
typed Responses SSE events, including text deltas, function-call argument
deltas, completed output items, and a final `response.completed` or
`response.incomplete` event. The conversion remains streaming and propagates
client cancellation. Upstream error responses retain their status and error
body.

Converted streams independently limit an SSE record to 1 MiB, retained text to
4 MiB, retained tool arguments to 4 MiB, tool metadata to 64 KiB, tool calls to
64, and output items to 64. A malformed record or exceeded limit emits a
terminal error event, emits no success terminal event, and cancels the upstream
stream. The final Responses event therefore retains at most 8 MiB of generated
content: 4 MiB of text plus 4 MiB of tool arguments, with item and metadata
overhead bounded separately.

Each SSE record's `data:` lines are joined with newlines. A stream that ends
without `[DONE]` emits a terminal `error` event instead of
`response.completed` or `response.incomplete`.

When `CHAT_RESPONSE_METADATA_ENABLED=true`, converted JSON includes the same
top-level `llm_proxy` routing and timing object as Chat Completions. Streaming
output includes it in the final `response.completed` or
`response.incomplete` event's `response`; it is not exposed as a Chat chunk.

The proxy has no conversation store or built-in tool executor. It therefore
returns HTTP 400 for state references such as `previous_response_id`, built-in
storage, built-in tools, file inputs, background execution, and other fields that cannot be
represented faithfully by Chat Completions. Unknown request fields are also
rejected instead of being silently discarded. See the
[Responses compatibility design](design/features/responses-api.md) for the
complete boundary.

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

Content blocks never interleave. The text block is closed before the first
`tool_use` block opens, and each `tool_use` block is emitted complete — start,
one `input_json_delta`, stop — after the text block ends. Tool arguments are
therefore not streamed incrementally; text deltas still are.

Messages streams use the same independent SSE, text, tool-argument, tool-count,
and output-item limits as Responses; Messages does not retain tool metadata.
A malformed record, an exceeded limit, or an upstream stream that ends without
its `[DONE]` sentinel emits a terminal error event, emits no `message_stop`,
and cancels the upstream stream. Each SSE record's `data:` lines are joined
with newlines.

Unknown fields and features without a direct Chat equivalent—including
documents, citations, cache controls, thinking, server tools, MCP, containers,
and context management—return HTTP 400. Use `/anthropic/v1/messages` when the
complete provider-native contract is required. See the
[Messages compatibility design](design/features/messages-api.md) for the exact
boundary.

## Models

`GET /v1/models` queries configured providers and prefixes each returned ID
with its route selector. Default-profile IDs use `<provider>/<model>` and
named-profile IDs use `<provider>:<profile>/<model>`. When `VIRTUAL_MODELS` is configured, every virtual model is
listed first — ahead of the provider models — with `owned_by: "virtual"`, so
clients discover them at the front of the list. All configured providers are
queried concurrently, each with a 30-second timeout and 1 MiB response limit. At most 1,000 models
per provider and 4 MiB of serialized model entries are retained. A bounded
aggregate includes `X-Proxy-Models-Truncated: true` when it is truncated.
Non-successful upstream responses are discarded before provider-specific model
conversion. Failures are logged and omitted, so a successful response may be
partial.

Successful complete aggregates are cached for `MODELS_CACHE_TTL_SECONDS`
(default 300, `0` disables) per gateway and key selection, and served with
`X-Proxy-Models-Cache: HIT` or `MISS`. Partial or truncated aggregates are
served but never cached. `Cache-Control: no-cache` on the request skips the
cached copy and refreshes it; `Cache-Control: no-store` or any `cf-aig-*`
request header bypasses the cache entirely, and bypassed responses carry no
cache header. The cache is per Cloudflare datacenter, so a configuration
change can serve a stale list from an already-primed datacenter for up to the
TTL. Cache API `open`, `match`, and `put` are optional optimizations: if an
operation is unavailable or fails, the request continues with an uncached
provider fan-out. The cache is ineffective on a `*.workers.dev` deployment;
use a custom domain to enable it.

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
          "model": "virtual/fast",
          "retries": 1,
          "attempts": 2,
          "timeout_ms": 5000,
          "access_order": [
            {
              "position": 1,
              "model": "openai/gpt-4o-mini",
              "retries": 0,
              "attempts": 1
            },
            {
              "position": 2,
              "model": "anthropic/claude-sonnet",
              "retries": 0,
              "attempts": 1
            }
          ]
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

Custom endpoints should define a static `models` list when reliable discovery
matters. The endpoint uses the first provider key by default to avoid advancing
key rotation merely for discovery. Amazon Bedrock and Azure OpenAI are omitted
without sending an upstream request unless all of their required local
credentials and routing identifiers are configured, even when
`ALWAYS_USE_AI_GATEWAY=true`.

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
through byte-for-byte, including empty fields; the proxy does not re-encode or
reorder them, and it does not resolve dot segments in a path that carries a
query string.

All outbound requests use manual redirect handling, so the Worker never follows
a redirect with credentials attached. Pass-through routes return upstream 3xx
responses unchanged; clients must not replay the proxy credential when following
them.
Request-level `cf-aig-*` control headers are forwarded when the selected route
uses AI Gateway and removed on direct provider requests. Client
`cf-aig-authorization` and `cf-aig-byok-alias` are always removed; Gateway
authentication and stored-credential selection remain operator-controlled.
Provider-specific request and response formats remain the caller's
responsibility. Routes are the keys registered in `src/providers.ts`; configured
custom endpoint names are added dynamically.

In strict Gateway mode, pass-through paths for a managed Custom Provider retain
the adapter's fixed path prefix. A final version-looking Base URL segment is
repeated at the start of the Gateway request path. An unversioned Base URL is
registered with a `/v1` sentinel that Cloudflare consumes during Custom Provider
URL resolution. These transformations apply only to strict Gateway routing;
direct pass-through keeps the configured Base URL unchanged.

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
  --data '{"model":"openai/gpt-5.6-sol","input":"Hello"}'
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

Timeouts, unsupported model listing, and non-authentication HTTP failures are
reported as `unknown`. Authentication failures and unexpected fetch errors are
`invalid`; unexpected fetch errors are also logged.

The check count follows the deployed credential count and can exhaust the
per-request subrequest budget. After authentication, provider and check failures
remain isolated: unexamined slots stay `unknown`, and providers that cannot be
described report `available: false` with no key slots.

## Errors

Known routing and authentication errors use JSON with an HTTP status. Unexpected
errors return a generic HTTP 500 response and details are written only to Worker
logs. Provider error bodies and status codes are normally forwarded as received.
Requests whose decoded body exceeds 10 MiB return HTTP 413 before JSON parsing,
including Responses and Messages requests.
