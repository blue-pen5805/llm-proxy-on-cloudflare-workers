# Monitoring and Diagnostics

## Health surfaces

The Worker exposes two authenticated health routes:

- `/ping` returns `Pong` without provider subrequests. It is a liveness check
  for routing and Worker execution only.
- `/status` returns sanitized configuration and runs credential connectivity
  checks. It is an operator diagnostic, not a low-cost liveness probe.

All three proxy-generated health surfaces (`/ping`, `/status`, and
`/virtual-models`) use `Cache-Control: no-store`.

## Status algorithm

For each configured credential, `/status` calls the provider's model-list path
directly or through the active AI Gateway. Checks start concurrently with an
individual five-second timeout and isolated results.

The number of checks follows the deployed credential count, so a large
configuration can exhaust the per-request subrequest budget. Provider
descriptions and checks fail independently: unexamined slots stay `unknown`,
and an unreadable provider reports `available: false` with no key slots and a
`provider.status.failed` log. Subrequest-limit exceptions also leave the
affected slot `unknown`. Many `unknown` slots indicate an incomplete scan.
The unrestricted fan-out is intentional: `/status` is an authenticated,
best-effort diagnostic rather than a low-cost health probe, and starting checks
concurrently prevents one slow provider from delaying all others.

`STATUS_CACHE_TTL_SECONDS` optionally caches a complete compact status response
in the per-datacenter Cache API. The default `0` preserves live checks.
`Cache-Control: no-cache` refreshes the entry, `no-store` bypasses it, and
client responses remain `no-store` regardless of the internal TTL.

The status handler shares the model-list Gateway capability decision with the
normal model aggregation route. A provider that sets
`endpoints.models.supportsAiGateway=false` is checked directly even when a
Gateway is active. If its adapter also declares direct model listing unsupported, the
credential remains `unknown`; diagnostics do not attempt a known-unsupported
Gateway route.

Responses are classified as follows:

| Result                               | Status                  |
| ------------------------------------ | ----------------------- |
| Successful HTTP response             | `valid`                 |
| HTTP 401 or 403                      | `invalid`               |
| Other non-success HTTP response      | `unknown`               |
| Unsupported model listing or timeout | `unknown`               |
| Unexpected exception                 | `invalid` after logging |
| Check that could not be started      | `unknown`               |

This is connectivity evidence, not proof that every model, quota, permission,
or API operation works. Conversely, a transient failure can make a usable key
appear invalid or unknown.

## Disclosure controls

Provider credentials are represented only by zero-based slot numbers and
connectivity status; no key value or suffix is returned. AI Gateway tokens
become `***`, but account and Gateway identifiers remain visible. Default model,
strict AI Gateway mode, development mode, API-key cooldown duration, provider
names, key counts, and whether OpenAI-compatible response metadata is enabled are
also exposed.

The route passes through normal authentication. Authentication is disabled only
for a locally running Worker with `DEV` set, so a deployed `/status` is always
authenticated. Operators should not expose it publicly or use its output as an
unaudited monitoring payload.

## Platform observability

`wrangler.jsonc` enables Workers Logs for every invocation and sampled traces.
Application records contain a human-readable `message`, stable `event`, and
`request_id`, plus safe routing and outcome fields when applicable. The request
ID uses Cloudflare's `cf-ray` value when available and otherwise a generated
UUID.
The `cf-ray` value provides correlation and is not a client credential or
integrity proof. The authentication middleware also checks whether the header
is present before allowing the local `DEV` bypass. Supplying it locally disables
that bypass and requires normal proxy authentication.
Provider names observed in request-scoped events are carried into
`request.completed` as `provider` for one destination or a comma-separated
`providers` summary for multiple destinations.

The following events support operational queries:

| Event                                 | Meaning                                             |
| ------------------------------------- | --------------------------------------------------- |
| `request.started`                     | Routed handler started                              |
| `request.completed`                   | Handler completed, with status and latency          |
| `request.unhandled_error`             | An unexpected exception reached the guard           |
| `subrequest.started`                  | Provider request started                            |
| `subrequest.completed`                | Provider request returned an HTTP response          |
| `subrequest.failed`                   | Provider request failed before a response           |
| `provider.models.failed`              | A provider model-list operation failed              |
| `provider.models.invalid_response`    | A model-list response could not be used             |
| `provider.models.aggregate_truncated` | The model list hit its count or byte bound          |
| `provider.models.key_retry`           | Model discovery will retry the next key after 429   |
| `models.cache.unavailable`            | An optional model cache operation failed            |
| `status.cache.unavailable`            | An optional status cache operation failed           |
| `provider.connectivity.failed`        | A status connectivity check failed                  |
| `provider.status.failed`              | A provider could not describe itself                |
| `provider.credential.missing`         | A provider that requires local credentials has none |
| `auth.development_mode_ignored`       | `DEV` was ignored on a deployed Worker              |
| `provider.key.selected`               | A credential slot was selected                      |
| `provider.key.cooldown`               | A credential slot entered cooldown                  |
| `virtual_model.select`                | A candidate was selected for an attempt             |
| `virtual_model.retry`                 | Another candidate attempt will be made              |
| `virtual_model.completed`             | The final candidate attempt completed               |

`request.started` always includes the HTTP method and query-free path. Once a
route has resolved safe routing metadata, it also reports an `endpoint` label.
Chat Completions, Responses, and Messages requests report the concrete
`provider`, optional non-default `credential_profile`, and redacted,
length-limited `model` before credential selection or upstream I/O. Virtual
model requests report the configured virtual model name; their concrete
providers remain visible in subsequent candidate events. Provider pass-through
requests report their provider. Requests rejected before routing and preflight
requests retain the method/path-only fallback.

`duration_ms` on `request.completed` measures time until response headers are
available; it does not wait for a streamed response body to finish.
`subrequest.started` is emitted immediately before each upstream `fetch`.
Subrequest events include their HTTP method and query-free upstream URL. Chat
Completions, Responses, and Messages subrequests also include the concrete,
redacted, length-limited `model`; pass-through and aggregate operations omit it
when the proxy cannot determine one without parsing otherwise preserved traffic.
Completion adds status and duration, while failure adds duration and safe error
fields. Error events contain only a redacted, length-limited error name and
message. Request bodies, response bodies, headers, stack traces, query strings,
fragments, and arbitrary thrown objects are not logged.

`provider.key.selected` reports `provider`, `operation`, zero-based
`key_index`, `key_count`, `credential_configured`, `selection_policy`, and
`via_ai_gateway`. Named profiles also report `credential_profile`; the default
profile omits that field. For one-to-one provider requests, a generated
`provider_request_id` links the selection to its
`subrequest.completed` or `subrequest.failed` event. Gateway Compatibility
fallback emits one selection event and one request ID for each credential that
is actually attempted. Universal Endpoint steps share one aggregate subrequest,
so their selection events instead include a zero-based `step` number.
Credential values, partial values, and derived fingerprints are never logged.
Indexes identify configuration order only and can change when keys are
reordered.

`provider.credential.missing` reports the provider selector and the operator
credential setting name. It fires only for adapters that require a local
credential, currently Vertex AI (`GOOGLE_VERTEX_AI_SERVICE_ACCOUNT_JSON`). It
never logs a credential value.

`provider.key.cooldown` reports the provider, zero-based `key_index`,
`key_count`, upstream `status`, and configured `cooldown_seconds`. It follows
the same slot-only disclosure policy and never logs credential material.

`provider.models.key_retry` reports the provider, optional non-default
`credential_profile`, the zero-based `key_index` that returned HTTP 429, the
`next_key_index` that will be tried, `status`, and the 1-based failed
`attempt`. It is emitted only for automatic model discovery before a later key
is requested.

## References

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
