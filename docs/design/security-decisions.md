# Security Design Decisions

This document defines intentional security behavior, accepted risks, rationale,
and enforced boundaries.

## CORS defaults to a wildcard unless the operator supplies an allowlist

**Behavior.** `ALLOWED_ORIGINS` can contain up to 64 exact HTTP(S) origins.
Configured matches are reflected in `Access-Control-Allow-Origin`; other
origins receive no allow-origin header. When the setting is absent, the Worker
retains the backward-compatible `*` response.

**Rationale.** Proxy authentication remains the security boundary, while an
origin allowlist reduces browser-based use of a disclosed credential without
breaking deployments that intentionally serve several browser clients.

**Boundary that _is_ enforced.** Origins are matched as complete URL origins,
not suffixes or patterns. Preflight remains unauthenticated, responses vary on
`Origin`, and a denied origin cannot cause requested headers to be reflected.

## Client-controlled `cf-aig-*` request headers are forwarded to AI Gateway

**Behavior.** When a request is routed through Cloudflare AI Gateway, headers
beginning with `cf-aig-` (for example `cf-aig-metadata`, `cf-aig-collect-log`,
`cf-aig-skip-cache`, and the retry/backoff controls) are passed through from the
client to Gateway.

**Rationale.** Per-request Gateway tuning is a supported feature: callers
legitimately tag requests (`cf-aig-metadata`), set cost/logging/caching
behavior, and control retries.

For valid object-valued `cf-aig-metadata`, the proxy fills unused keys with
bounded routing metadata. Client values win on collisions; invalid client
metadata is forwarded unchanged rather than reinterpreted or replaced.

**Boundary that _is_ enforced.** Credential- and isolation-sensitive Gateway
headers are never accepted from a client and are always removed:
`cf-aig-authorization` (Gateway auth), `cf-aig-byok-alias` (stored-credential
selection), and `cf-aig-cache-key` (response-cache partition; accepting it would
allow cross-caller cache reads or poisoning). See
`OPERATOR_CONTROLLED_AI_GATEWAY_HEADERS` and `stripProxyAuthorizationHeaders`
in `src/utils/authorization.ts`.

## Client-controlled names never resolve through an object's prototype

**Behavior.** Client-supplied provider selectors, credential profiles, and
virtual model names match only registered entries. Provider routes use a `Set`,
object lookups require own properties, and the virtual-model map has a null
prototype.

**Rationale.** Plain objects inherit names such as `toString` and `constructor`,
while assigning `__proto__` can replace the prototype. Treating those names as
configured entries could cause HTTP 500 responses or discard a virtual model.

**Boundary that _is_ enforced.** Inherited names return "not configured", while
`__proto__` remains a valid virtual-model key. The adversarial-input regression
suite covers this boundary.

## `/models` and `/status` fan out to every provider

**Behavior.** A single authenticated `GET /models` or `GET /status` request
issues upstream subrequests to every configured provider (and, for `/status`,
every key slot).

**Rationale.** These routes are best-effort diagnostics, not transactional
guarantees, and both require a valid `PROXY_API_KEY`. `/models` starts every
configured provider concurrently with a 30-second per-provider timeout, while
`/status` starts every configured credential check concurrently with an
individual five-second timeout.

**Boundary that _is_ enforced.** Fan-out can reach the per-request subrequest
limit. Provider and check failures remain isolated, yielding omitted providers
or `unknown` credential slots instead of failing an authenticated diagnostic.
Validated provider configuration limits, per-provider response-size caps, and a
4 MB aggregate cap bound `/models`; see `src/requests/models.ts` and
`src/requests/status.ts`. For `/models`, the short-lived response cache
(`MODELS_CACHE_TTL_SECONDS`, default 300 seconds) additionally absorbs repeated
listings, though a client can still force a fan-out with
`Cache-Control: no-store`/`no-cache` or a `cf-aig-*` header.

## `cf-ray` is used as the log `request_id`

**Behavior.** The structured-log request identifier is taken from the incoming
`cf-ray` header, falling back to a generated UUID (`src/utils/logger.ts`).

**Rationale.** `cf-ray` is set by the Cloudflare edge for real traffic, and the
identifier is used only for log correlation — never as an authorization or
integrity control. A spoofed value can at most muddle log correlation for the
spoofer's own requests; it grants no access and affects no routing.

## Clients can select the upstream key slot via `/key/...`

**Behavior.** The `/key/<index>/…` and `/key/<start>-<end>/…` path prefixes let
an authenticated caller choose which provider key slot is used
(`src/middlewares/api_key_path.ts`).

**Rationale.** This is a diagnostic/operational feature for exercising a specific
credential (for example, to confirm a rotated key works). It never reveals key
material, and every selection is reduced into range with a modulo bound, so an
out-of-range index cannot escape the configured key set. See
`Secrets.resolveApiKeyIndex` in `src/utils/secrets.ts`.
