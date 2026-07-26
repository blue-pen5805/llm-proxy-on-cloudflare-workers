# Request-path Performance

## Scope

The proxy normally spends most of its wall time waiting for upstream model
providers. Local CPU work still matters because it runs before each subrequest
and counts against the Worker's CPU budget. Optimizations therefore target
repeated parsing and allocation on the authenticated request path without
buffering upstream responses or sharing request state globally.

## Chat request parsing

The chat handler parses and validates the incoming JSON once. The resulting
object is filtered by the selected provider, serialized once by the provider
request builder, and passed in parsed form to the AI Gateway request builder.
The serialized-only builder interfaces remain supported for existing callers,
but the Worker request path does not parse or serialize the same body again.

This reduces JSON parsing from two passes to one for direct provider requests
and from three passes to one for AI Gateway requests. Upstream responses remain
streamed through unchanged.

## Bounded model aggregation

Model discovery reads at most 1 MiB from one provider, queries every configured
provider concurrently, retains at most 1,000 models per provider, and caps the
serialized aggregate model entries at 4 MiB. A truncated response includes
`X-Proxy-Models-Truncated: true`. The provider set remains bounded by the fixed
built-in registry and validated configuration limits; the response limits
prevent individually bounded provider responses from accumulating beyond the
Worker's isolate memory limit. Non-successful upstream responses are not parsed
as provider model payloads.

## Model aggregate caching

`GET /v1/models` fans out to every configured provider, which makes it the
most expensive read-only route. Successful complete aggregates are stored in
the Workers Cache API (a dedicated cache named `llm-proxy-models`) for
`MODELS_CACHE_TTL_SECONDS` (default 300 seconds, `0` disables), so repeated
listings within the TTL cost one cache read instead of a provider fan-out.
Served responses carry `X-Proxy-Models-Cache: HIT` or `MISS` for
observability; bypassed responses carry no cache header.

The cache key is built exclusively from operator-validated values — AI Gateway
account and gateway ids (charset-checked at construction), the `alwaysUse`
mode, and the parsed `/key/...` selection — so clients cannot create arbitrary
cache partitions or poison another scope. Requests that carry `cf-aig-*`
Gateway tuning headers or `Cache-Control: no-store` bypass the cache entirely;
`Cache-Control: no-cache` skips the read but refreshes the entry. Aggregates
with a failed provider or a truncated result are served but never stored, so a
transient upstream outage cannot pin a degraded list for the full TTL. The
stored copy's `Cache-Control` header only encodes the internal TTL and is
stripped before the response is served, keeping responses issued under
`Authorization` out of shared HTTP caches. Cache writes ride
`ctx.waitUntil`, keeping the store off the response's critical path.

The Cache API is per-datacenter: each Cloudflare location warms its own entry,
and a configuration change (for example adding a provider key) can serve a
stale list from an already-primed datacenter for up to the TTL. The short
default TTL bounds that staleness without a global purge mechanism.

## Provider route index

`ProviderRegistry` snapshots built-in and custom provider names when the
request-scoped registry is created. Route matching reads that immutable index,
and custom-provider lookup uses a map. It does not rebuild provider-name arrays
or scan custom endpoint configuration for each lookup.

## Benchmarking

Run `npm run bench` to exercise the CPU-only request-building and routing hot
paths. Benchmarks are diagnostic rather than correctness gates because absolute
results vary by machine. Compare the same benchmark, runtime version, and input
before and after a performance change; correctness remains enforced by the
Worker-runtime test suite and coverage thresholds.
