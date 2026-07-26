# Monitoring and Diagnostics

## Health surfaces

The Worker exposes two authenticated health routes:

- `/ping` returns `Pong` without provider subrequests. It is a liveness check
  for routing and Worker execution only.
- `/status` returns sanitized configuration and runs credential connectivity
  checks. It is an operator diagnostic, not a low-cost liveness probe. Its
  response is serialized as compact JSON to avoid diagnostic-only whitespace.

## Status algorithm

The handler constructs every built-in and custom provider instance. For each
configured credential, it calls the provider's model-list path, either directly
or through the active AI Gateway. Checks run concurrently with an individual
five-second timeout. Every configured credential check starts immediately
without an application-level concurrency cap. Each result remains isolated, so
one slow or failed check does not prevent the other credential slots from being
examined.

The number of checks follows the deployed credential count, so a large
configuration can exhaust the per-request subrequest budget. Provider
descriptions and checks fail independently: unexamined slots stay `unknown`,
and an unreadable provider reports `available: false` with no key slots and a
`provider.status.failed` log. Subrequest-limit exceptions also leave the
affected slot `unknown`. Many `unknown` slots indicate an incomplete scan.

The status handler shares the model-list Gateway capability decision with the
normal model aggregation route. A provider that sets
`supportsAiGatewayModels=false` is checked directly even when a Gateway is
active. If its adapter also declares direct model listing unsupported, the
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
Application logs are structured JSON objects with a human-readable `message`, a
stable `event` field, and a `request_id`. The logger requires every record to
provide `message` so Cloudflare Workers Observability can populate its summary
Message column. Every request-scoped message starts with the first eight
characters of its request ID in brackets, allowing related records to be
identified at a glance while the complete value remains available in
`request_id`. The remainder includes the event's most useful safe fields, such
as provider, operation, HTTP method, query-free destination, status, credential
slot, selection policy, and duration as applicable. The request ID uses
Cloudflare's `cf-ray` value when available and falls back to a generated UUID.
Provider names observed in request-scoped events are carried into
`request.completed` as `provider` for one destination or a comma-separated
`providers` summary for multiple destinations.

The following events support operational queries:

| Event                              | Meaning                                    |
| ---------------------------------- | ------------------------------------------ |
| `request.started`                  | Routed handler started                     |
| `request.completed`                | Handler completed, with status and latency |
| `request.unhandled_error`          | An unexpected exception reached the guard  |
| `subrequest.started`               | Provider request started                   |
| `subrequest.completed`             | Provider request returned an HTTP response |
| `subrequest.failed`                | Provider request failed before a response  |
| `provider.models.failed`           | A provider model-list operation failed     |
| `provider.models.invalid_response` | A model-list response could not be used    |
| `models.cache.unavailable`         | An optional model cache operation failed   |
| `provider.connectivity.failed`     | A status connectivity check failed         |
| `provider.status.failed`           | A provider could not describe itself       |
| `auth.development_mode_ignored`    | `DEV` was ignored on a deployed Worker     |
| `provider.key.selected`            | A credential slot was selected             |
| `provider.key.cooldown`            | A credential slot entered cooldown         |
| `virtual_model.select`             | A candidate was selected for an attempt    |
| `virtual_model.retry`              | Another candidate attempt will be made     |
| `virtual_model.completed`          | The final candidate attempt completed      |

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

`provider.key.cooldown` reports the provider, zero-based `key_index`,
`key_count`, upstream `status`, and configured `cooldown_seconds`. It follows
the same slot-only disclosure policy and never logs credential material.

## References

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
