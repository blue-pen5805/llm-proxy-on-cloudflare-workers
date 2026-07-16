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

Keys of four or more characters reveal only their final three characters;
shorter values become `***`. The AI Gateway token becomes `***`, but account and
Gateway identifiers remain visible. Default model, development mode, global
round-robin state, provider names, and key counts are also exposed.

The route passes through normal authentication, except when authentication has
been disabled by configuration. Operators should not expose it publicly or use
its output as an unaudited monitoring payload.

## Platform observability

`wrangler.jsonc` enables Workers Logs and sampled traces. `fetch2` emits one
informational log per upstream subrequest with recognized sensitive query values
masked. Unexpected errors and partial model-list failures are written to logs.

The application does not currently emit structured metrics, request IDs, or
provider latency histograms. Those are explicit future extensions rather than
properties of the existing status endpoint.

## References

- [Workers observability](https://developers.cloudflare.com/workers/observability/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
