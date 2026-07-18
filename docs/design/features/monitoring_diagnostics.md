# Monitoring and Diagnostics

## Health surfaces

The Worker exposes two authenticated health routes:

- `/ping` returns `Pong` without provider subrequests. It is a liveness check
  for routing and Worker execution only.
- `/status` returns sanitized configuration and runs credential connectivity
  checks. It is an operator diagnostic, not a low-cost liveness probe.

## Status algorithm

The handler constructs every built-in and custom provider instance. For each
configured credential, it calls the provider's model-list path, either directly
or through the active AI Gateway. Checks run concurrently with an individual
five-second timeout.

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

This is connectivity evidence, not proof that every model, quota, permission,
or API operation works. Conversely, a transient failure can make a usable key
appear invalid or unknown.

## Disclosure controls

Provider credentials are represented only by zero-based slot numbers and
connectivity status; no key value or suffix is returned. AI Gateway tokens
become `***`, but account and Gateway identifiers remain visible. Default model,
development mode, global round-robin state, provider names, and key counts are
also exposed.

The route passes through normal authentication, except when authentication has
been disabled by configuration. Operators should not expose it publicly or use
its output as an unaudited monitoring payload.

## Platform observability

`wrangler.jsonc` enables Workers Logs for every invocation and sampled traces.
Application logs are structured JSON objects with a stable `event` field and a
`request_id`. The request ID uses Cloudflare's `cf-ray` value when available and
falls back to a generated UUID.

The following events support operational queries:

| Event                              | Meaning                                    |
| ---------------------------------- | ------------------------------------------ |
| `request.completed`                | Handler completed, with status and latency |
| `request.unhandled_error`          | An unexpected exception reached the guard  |
| `subrequest.completed`             | Provider request returned an HTTP response |
| `subrequest.failed`                | Provider request failed before a response  |
| `provider.models.failed`           | A provider model-list operation failed     |
| `provider.models.invalid_response` | A model-list response could not be used    |
| `provider.connectivity.failed`     | A status connectivity check failed         |
| `provider.key.selected`            | A credential slot was selected             |

`duration_ms` on `request.completed` measures time until response headers are
available; it does not wait for a streamed response body to finish. Subrequest
events include their HTTP method, query-free upstream URL, status when available,
and duration. Error events contain only a redacted, length-limited error name and
message. Request bodies, response bodies, headers, stack traces, query strings,
fragments, and arbitrary thrown objects are not logged.

`provider.key.selected` reports `provider`, `operation`, zero-based
`key_index`, `key_count`, `credential_configured`, `selection_policy`, and
`via_ai_gateway`. For one-to-one provider requests, a generated
`provider_request_id` links the selection to its
`subrequest.completed` or `subrequest.failed` event. Gateway Compatibility
fallback emits one selection event and one request ID for each credential that
is actually attempted. Universal Endpoint steps share one aggregate subrequest,
so their selection events instead include a zero-based `step` number.
Credential values, partial values, and derived fingerprints are never logged.
Indexes identify configuration order only and can change when keys are
reordered.

## References

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
