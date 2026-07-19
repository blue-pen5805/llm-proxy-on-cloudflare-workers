# Security Design Decisions

Behaviors that are intentional or accepted risks, documented so they are not
repeatedly questioned. Each entry states the behavior, the rationale, where it
lives, and the condition under which it should be reconsidered.

## Client-controlled `cf-aig-*` request headers are forwarded to AI Gateway

**Behavior.** When a request is routed through Cloudflare AI Gateway, headers
beginning with `cf-aig-` (for example `cf-aig-metadata`, `cf-aig-collect-log`,
`cf-aig-skip-cache`, and the retry/backoff controls) are passed through from the
client to Gateway.

**Rationale.** Per-request Gateway tuning is a supported feature: callers
legitimately tag requests (`cf-aig-metadata`), set cost/logging/caching
behavior, and control retries.

**Boundary that _is_ enforced.** Credential- and isolation-sensitive Gateway
headers are never accepted from a client and are always removed:
`cf-aig-authorization` (Gateway auth), `cf-aig-byok-alias` (stored-credential
selection), and `cf-aig-cache-key` (response-cache partition; accepting it would
allow cross-caller cache reads or poisoning). See
`OPERATOR_CONTROLLED_AI_GATEWAY_HEADERS` and `stripProxyAuthorizationHeaders`
in `src/utils/authorization.ts`.

**Reconsider if.** The proxy is deployed multi-tenant behind a single shared
Gateway where callers must not influence each other's analytics/cost/log
records. In that case, move the relevant `cf-aig-*` headers to the
operator-controlled set as well.

## `/models` and `/status` fan out to every provider

**Behavior.** A single authenticated `GET /models` or `GET /status` request
issues upstream subrequests to every configured provider (and, for `/status`,
every key slot).

**Rationale.** These routes are best-effort diagnostics, not transactional
guarantees, and both require a valid `PROXY_API_KEY`. The blast radius is bounded
in code: batched concurrency (`MODEL_PROVIDER_CONCURRENCY` and
`STATUS_CONNECTIVITY_CONCURRENCY`, both 5), a 5-second per-provider timeout, a
per-provider response-size cap, and a 4 MB aggregate cap. See
`src/requests/models.ts` and `src/requests/status.ts`.

**Reconsider if.** These routes are exposed to low-trust clients or provider
rate limits become a practical concern. A short-lived cache or a per-key rate
limit would mitigate it.

## `cf-ray` is used as the log `request_id`

**Behavior.** The structured-log request identifier is taken from the incoming
`cf-ray` header, falling back to a generated UUID (`src/utils/logger.ts`).

**Rationale.** `cf-ray` is set by the Cloudflare edge for real traffic, and the
identifier is used only for log correlation — never as an authorization or
integrity control. A spoofed value can at most muddle log correlation for the
spoofer's own requests; it grants no access and affects no routing.

**Reconsider if.** Logs become an input to an automated security decision (for
example, correlation-based blocking), at which point the id should be
server-generated unconditionally.

## Clients can select the upstream key slot via `/key/...`

**Behavior.** The `/key/<index>/…` and `/key/<start>-<end>/…` path prefixes let
an authenticated caller choose which provider key slot is used
(`src/middlewares/api_key_path.ts`).

**Rationale.** This is a diagnostic/operational feature for exercising a specific
credential (for example, to confirm a rotated key works). It never reveals key
material, and every selection is reduced into range with a modulo bound, so an
out-of-range index cannot escape the configured key set. See
`Secrets.resolveApiKeyIndex` in `src/utils/secrets.ts`.

**Reconsider if.** Key-slot selection should be operator-only. Gating the
feature behind a configuration flag would separate the diagnostic capability
from ordinary proxy traffic.
