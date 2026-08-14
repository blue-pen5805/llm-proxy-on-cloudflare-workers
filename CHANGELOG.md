# Changelog

Changes to application functionality and externally observable runtime behavior
are documented in this file. Date entries in `YYYY-MM-DD` format and order them
in reverse chronological order. Add new entries at the top of the relevant
dated section; when multiple changes share a date, put the newest change first.

## Unreleased

Planned version: `1.0.0`. The package remains at `0.2.1` until the version
update is explicitly approved.

### 2026-08-14

- Chat Completions now removes only parameters explicitly unsupported by the
  selected provider; unclassified extension and future fields pass through.
- Responses now converts direct Chat equivalents and ignores removed, unknown,
  or independently removable unsupported fields, items, content parts, and
  tools instead of rejecting the complete request. Standard `include` log-prob
  requests are converted, stream delta obfuscation is retained once per bounded
  upstream chunk unless disabled, and empty allowed-tool choices produced by
  filtering are omitted.
- Messages now converts compatible output, system, content, and tool options
  while ignoring unknown or independently removable unsupported fields,
  content blocks, and tools instead of rejecting the complete request.
- Extended each provider's aggregated model-discovery timeout from 30 to 60
  seconds.

### 2026-08-08

- Accepted `summary`, `context`, and future options inside Responses
  `reasoning` objects without forwarding them to Chat Completions, while still
  converting `reasoning.effort` and rejecting non-object `reasoning` values.
- Ignored top-level Responses request fields without a supported Chat
  Completions conversion instead of rejecting or forwarding them, while
  converting compatible nested verbosity, file, function/custom-tool, and
  allowed-tool-choice fields and retaining explicit rejection of unknown fields
  and unsupported nested features. Converted JSON and streams now also expose
  Chat custom-tool calls as Responses custom-tool output and events.

### 2026-07-27

- Fixed configuration reading so a credential containing `", }"` or `", ]"` is
  no longer silently rewritten before being written to `.dev.vars` or deployed
  as a Worker secret.
- Fixed provider credential parsing so a quoted string such as `"12345"`,
  `"true"`, or `"null"` is kept as the configured text instead of being read as
  another JSON type and discarded, which left a configured provider reporting
  itself as unavailable. Only an explicit JSON array or object still carries
  structure, and the bare literal `null` still means secret deletion.
- Rejected configuration that the Worker's own readers refuse before
  `npm run secrets:deploy` deploys any secret, instead of deploying it and
  failing every subsequent request with HTTP 503. The check evaluates the
  configuration the deployment results in, so documented no-op empty values are
  not rejected, and `CUSTOM_OPENAI_ENDPOINTS` and `VIRTUAL_MODELS` must now
  change together because a setting that is not deployed keeps its deployed
  value. Deleting `VIRTUAL_MODELS` removes the graph entirely and is still
  accepted on its own.
- Authenticated requests before parsing a `/key/<selection>` prefix, so an
  unauthenticated client receives HTTP 401 rather than HTTP 400 for a malformed
  selection.
- Added `WWW-Authenticate: Bearer` to proxy-issued HTTP 401 responses.
- Listed a custom OpenAI endpoint named `__proto__` in `/v1/models` and
  `/status`; it was previously reachable only through its routes.
- Reduced the work of `GET /v1/models/<model>` and of chat response metadata by
  removing an aggregate serialize-and-reparse round trip and a duplicated
  in-memory copy of the upstream body.
- Added English and Japanese localization to the interactive `npm run secrets`
  editor, with language selection as its first prompt.
- Added exact-origin CORS allowlisting, authenticated proxy-key slot logging,
  and client-priority AI Gateway metadata tags for resolved routes, public
  proxy endpoints, selected provider credential slots, and client-requested
  virtual models without exposing credential values.
- Added bodyless `HEAD` support for health and model routes, exact model
  retrieval, provider-filtered model aggregation, and an explicit Anthropic
  error for unsupported Messages token counting.
- Standardized proxy-local OpenAI errors, returned an explanatory error for
  `/g/...` without an account ID, and disabled HTTP caching of generated
  diagnostics and model responses.
- Added opt-in `/status` caching and bounded Worker invocations to 1,000 ms of
  CPU time.
- Reduced SSE transformation CPU work by sharing incremental record parsing
  across Responses, Messages, and response metadata.

### 2026-07-26

- Rejected inherited `Object.prototype` names in client-supplied provider,
  credential-profile, and virtual-model selectors with HTTP 400.
  `VIRTUAL_MODELS` also retains `__proto__` as an ordinary model name.
- Hardened Responses and Messages streaming by joining multiline SSE data,
  requiring the `[DONE]` sentinel before success, and emitting a terminal error
  for truncated streams.
- Restricted `DEV` to locally running Workers. A deployed Worker keeps client
  authentication enforced even when the binding is present, and logs
  `auth.development_mode_ignored`.
- Isolated `/status` provider descriptions and connectivity checks so individual
  failures leave affected entries `unknown` without failing the authenticated
  diagnostic.
- Emitted Anthropic Messages content blocks sequentially. The text block closes
  before the first `tool_use` block opens, and each `tool_use` block is emitted
  complete; tool arguments are no longer streamed incrementally.
- Preserved retained query parameters byte-for-byte when removing
  credential-like parameters, including empty fields, instead of re-encoding
  and reordering them.
  Proxied paths carrying a query string are no longer dot-segment normalized
  before the traversal check.
- Stopped splitting a provider credential that is not valid JSON on commas; such
  a value is now treated as a single opaque secret.
- Added `Vary: Origin` to cross-origin responses and preflight results, and
  kept CORS headers on error responses raised while handling CORS.
- Read a chat response body once instead of teeing it when adding optional
  `llm_proxy` metadata; malformed, non-object, and over-budget bodies are
  forwarded byte-for-byte.
- Removed the plaintext secret file left behind when `secrets:deploy` is
  interrupted, by asynchronously supervising Wrangler and cleaning up on
  `SIGINT`, `SIGTERM`, and `SIGHUP`.
- Prevented credential-bearing upstream requests from following redirects,
  removed `True-Client-IP` before forwarding, and kept cross-origin redirect
  destinations from receiving provider or AI Gateway credentials.
- Bounded converted SSE records, cumulative text, tool arguments, tool
  metadata, tool counts, and output items. Oversized or malformed streams now
  emit a terminal error without a contradictory success event and cancel the
  upstream body; oversized Responses and Messages request bodies retain HTTP
  413 classification.
- Made aggregated model caching optional: unavailable or failed Cache API
  `open`, `match`, and `put` operations now fall back to uncached provider
  fan-out.
- Added request and provider-subrequest start lifecycle logs and prefixed every
  request-scoped log message with the first eight request ID characters for
  at-a-glance correlation. Routed request starts include safe endpoint-specific
  provider, credential-profile, and model fields when applicable; chat-derived
  subrequest lifecycle events also include the concrete model. Virtual-model
  candidate attempts emit paired select and retry/completed events, while
  complete request IDs remain available as structured fields.
- Reduced Worker CPU work across request setup, provider forwarding, converted
  Responses and Messages requests, structured logging, virtual-model retries,
  and status checks. Converted requests now enter the Chat handler as parsed
  objects instead of being serialized into and reparsed from an intermediate
  `Request`; provider headers remain as `Headers`, URL/path sanitization avoids
  redundant parsing on normalized hot paths, and status connectivity checks
  start every configured credential subrequest without a local concurrency cap.
- Changed aggregated model discovery to query all configured providers
  concurrently and extended each provider's timeout from 5 to 30 seconds.

### 2026-07-22

- Added experimental Anthropic-compatible `POST /v1/messages` and `/messages`
  routes with bounded Messages-to-Chat Completions conversion and streaming
  JSON/SSE conversion back to Anthropic message, content, tool-use, stop-reason,
  and usage shapes. The routes reuse providers, virtual models, credential
  profiles, key rotation/cooldown, explicit key selection, AI Gateway routing,
  cancellation, and optional `llm_proxy` metadata, while rejecting unsupported
  provider-native and stateful features explicitly.
- Added experimental OpenAI-compatible `POST /v1/responses` and `/responses`
  routes with bounded Responses-to-Chat Completions request conversion and
  JSON/SSE conversion back to typed Responses output. The route reuses all
  existing providers, virtual models, credential profiles, key rotation/cooldown,
  and AI Gateway routing. It supports text/message/image inputs, function tools and
  call results, structured outputs, common generation parameters, streaming
  text and function arguments, and explicit errors for stateful, built-in-tool,
  file, background, or unknown features that Chat Completions cannot represent
  faithfully.
- Added opt-in `llm_proxy` routing and timing metadata to routed
  OpenAI-compatible Chat Completions and converted Responses output, including
  upstream JSON errors. `CHAT_RESPONSE_METADATA_ENABLED` defaults to `false`
  for strict client compatibility. When enabled, Chat SSE responses receive an
  empty-choice metadata chunk immediately before `[DONE]`; converted Responses
  streams retain it on the final response event. Both remain streaming while
  exposing the concrete provider/model, safe credential slot, AI Gateway route,
  request ID, and header/completion timings. Local pre-routing errors and
  malformed, oversized, or unrecognized response bodies remain unchanged.
- Added authenticated `GET /virtual-models` discovery, returning every
  configured virtual model in a `/models`-compatible list and model-object
  schema, extended with ordered candidates, retry, total-attempt, and optional
  response-header timeout metadata. Nested virtual-model references are expanded
  recursively while retaining their retry boundaries, and deployments without
  virtual models return an empty list.

### 2026-07-21

- Allowed virtual models to reference other virtual models recursively. Secret
  deployment dry-runs and real deployments now reject direct or indirect
  reference cycles before invoking Wrangler, and runtime validation repeats the
  check for configurations installed through other paths. Expanded nested
  chains remain bounded to 96 concrete provider attempts.
- Added named credential profiles for built-in and Custom OpenAI providers.
  Existing scalar and array credentials remain the `default` profile, while
  `<provider>:<profile>` selects an independent key pool for chat,
  pass-through, model discovery, status, and Universal Endpoint requests.
  Rotation, cooldowns, explicit key indices, AI Gateway credential alignment,
  model IDs, diagnostics, and safe structured logging now remain profile-aware.

### 2026-07-20

- Removed `ENABLE_GLOBAL_ROUND_ROBIN`; automatic multi-key selection now always
  uses striped per-isolate round-robin from a cryptographically random starting
  phase. Explicit `/key/...` selection and the first-key model-discovery policy
  are unchanged.
- Added isolate-local per-provider API-key cooldowns for chat and pass-through
  requests after upstream HTTP 401, 403, 404, 429, or 5xx responses. Automatic
  rotation skips cooling slots, while single-key providers, all-cooling key
  sets, and explicit `/key/...` selections remain usable. The new
  `API_KEY_COOLDOWN_SECONDS` setting defaults to 60 seconds and accepts `0` to
  disable the behavior.
- Added operator-defined virtual models via the new `VIRTUAL_MODELS` setting. A
  chat request whose `model` matches a configured key tries an ordered list of
  `"<provider>/<model>"` candidates in sequence, moving to the next candidate
  only after a retryable failure (HTTP 401, 403, 429, any 5xx, or a network
  error) and returning the first non-retryable response as-is. Candidates may
  configure up to five additional attempts before failover and a bounded
  response-header timeout in milliseconds. Keys are `"virtual/<name>"` by
  convention but may be any string matching `[A-Za-z0-9._~/-]{1,128}`; real
  providers and Custom OpenAI endpoints always take precedence, so a key that
  collides with one is shadowed and never reached. Configured virtual models are
  also advertised at the front of the `GET /v1/models` list with
  `owned_by: "virtual"`. At most 100 virtual models are accepted, each with 1 to
  16 candidates; malformed configuration fails authenticated requests with
  HTTP 503, matching `CUSTOM_OPENAI_ENDPOINTS`. See
  `docs/design/features/virtual_models.md`.
- Added a short-lived per-datacenter cache for the aggregated `GET /v1/models`
  response, configurable via the new `MODELS_CACHE_TTL_SECONDS` setting
  (default 300 seconds, `0` disables). Cached and freshly aggregated responses
  now carry `X-Proxy-Models-Cache: HIT`/`MISS`. Entries are scoped by AI
  Gateway identity and `/key/...` selection; requests with `cf-aig-*` headers
  or `Cache-Control: no-store` bypass the cache, `Cache-Control: no-cache`
  refreshes it, and partial or truncated aggregates are never stored.

### 2026-07-19

- Enabled Smart Placement (`placement.mode: "smart"`) so Cloudflare may run the
  Worker near the upstream provider APIs instead of near the client, reducing
  per-round-trip latency for provider fan-out and Gateway fallback chains.
  Response behavior is unchanged; Cloudflare reverts placement automatically if
  analysis finds it slower.
- Changed `PROXY_API_KEY` parsing so a single string value is always treated as
  one key (it may now contain commas or digits) and multiple keys must be
  provided as a JSON array. A single value is no longer split on commas or
  coerced from a numeric string. This is incompatible with comma-separated
  multi-key values, which must be converted to a JSON array.
- Stopped deploying the `DEV` flag as a Worker secret: it is now a local
  development-only setting, so deployed Workers always run with authentication
  enabled regardless of any configured `DEV` value.
- Stopped honoring a client-supplied `cf-aig-cache-key` header so a caller can
  no longer read from or poison another caller's AI Gateway cached response; the
  cache key is now operator-controlled.
- Rejected provider pass-through request paths that contain directory traversal
  (`..`), backslashes, control characters, or a URL scheme with
  `400 Bad Request`, preventing them from redirecting the upstream request.
- Made provider-computed request headers take precedence over caller-supplied
  headers on the OpenAI-compatible Chat Completions route, matching the
  pass-through route so request headers cannot override credential or routing
  headers.
- Replaced the provider configuration error that named the required environment
  variable with a generic "<provider> is not configured." message so the proxy
  no longer discloses its environment-variable names to clients.
- Added a human-readable `message` with relevant safe event details to every
  structured application log so Workers Observability summaries identify the
  provider, destination, result, and other applicable context.
- Added the Cline, Ollama, and NVIDIA NIM logos when creating or updating their
  managed AI Gateway Custom Providers.
- Skipped Amazon Bedrock and Azure OpenAI model-discovery requests when their
  required local provider credentials or routing identifiers are incomplete,
  including when AI Gateway routing is forced.
- Fixed strict AI Gateway Custom Provider routing for both versioned and
  unversioned Base URLs by compensating for Cloudflare's implicit `/v1` path
  rewriting.

### 2026-07-18

- Fixed strict AI Gateway Custom Provider routing to preserve a trailing `/v1`
  Base URL segment for Cline and configured custom endpoints.
- Added the `cline` provider.
- Added the `nvidia-nim` provider for NVIDIA's hosted OpenAI-compatible Chat
  Completions, model discovery, and pass-through API with configurable key
  rotation.
- Fixed strict AI Gateway routing for Ollama to preserve the `/v1` prefix in
  chat, model, and pass-through request paths.
- Fixed strict AI Gateway pass-through to authenticate Google AI Studio's
  OpenAI-compatible paths with the required Bearer credential.
- Added strict `ALWAYS_USE_AI_GATEWAY` routing with `default` Gateway fallback
  and deployment-time Custom Provider synchronization for provider operations
  that lack native AI Gateway routes.
- Fixed provider request header merging so case variants such as `Content-Type`
  and `content-type` produce one upstream field.
