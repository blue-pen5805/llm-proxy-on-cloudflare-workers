# Changelog

Changes to application functionality and externally observable runtime behavior
are documented in this file. Date entries in `YYYY-MM-DD` format and order them
in reverse chronological order. Add new entries at the top of the relevant
dated section; when multiple changes share a date, put the newest change first.

## Unreleased

Planned version: `1.0.0`. The package remains at `0.2.1` until the version
update is explicitly approved.

### 2026-07-20

- Added operator-defined virtual models via the new `VIRTUAL_MODELS` setting. A
  chat request with `"model": "virtual/<name>"` tries an ordered list of
  `"<provider>/<model>"` candidates in sequence, moving to the next candidate
  only after a retryable failure (HTTP 401, 403, 429, any 5xx, or a network
  error) and returning the first non-retryable response as-is. Candidates may
  configure up to five additional attempts before failover and a bounded
  response-header timeout in milliseconds. At most 100 virtual models are
  accepted, each with 1 to 16 candidates; malformed configuration fails
  authenticated requests with HTTP 503, matching
  `CUSTOM_OPENAI_ENDPOINTS`. See `docs/design/features/virtual_models.md`.
- Added a short-lived per-datacenter cache for the aggregated `GET /v1/models`
  response, configurable via the new `MODELS_CACHE_TTL_SECONDS` setting
  (default 300 seconds, `0` disables). Cached and freshly aggregated responses
  now carry `X-Proxy-Models-Cache: HIT`/`MISS`. Entries are scoped by AI
  Gateway identity and `/key/...` selection; requests with `cf-aig-*` headers
  or `Cache-Control: no-store` bypass the cache, `Cache-Control: no-cache`
  refreshes it, and partial or truncated aggregates are never stored.

### 2026-07-19

- Changed `ENABLE_GLOBAL_ROUND_ROBIN` key rotation from a coordinated global
  counter to striped per-isolate rotation: each
  Worker isolate rotates through the configured keys sequentially from a
  cryptographically random starting phase. Aggregate key usage stays
  near-uniform, but strict cross-isolate ordering is no longer guaranteed. This
  removes the per-request cross-isolate coordination round trip; stored rotation
  positions are not carried over.
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
