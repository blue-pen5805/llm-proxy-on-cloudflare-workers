# Request-path Performance

## Scope

This document records concrete request-path optimizations and their measurement
contract. The priority order, streaming rules, and resource-bounding principles
are defined once in [Project Principles](../../project-principles.md#minimize-worker-cpu-time-then-complexity).

## Decision priorities

Cloudflare measures CPU while Worker code executes, excluding network and
storage wait time. Consequently, concurrency improves wall-clock latency but
does not make local transformations free, and `ctx.waitUntil()` removes work
from the response path without removing its CPU cost. The sections below
describe where the implementation applies the project-wide priorities.

## Chat request parsing

The chat handler parses and validates the incoming JSON once. The resulting
object is filtered by the selected provider, serialized once by the provider
request builder, and passed in parsed form to the AI Gateway request builder.
The serialized-only builder interfaces are available to callers, but the Worker
request path performs one JSON parse for both direct provider and AI Gateway
requests. Upstream responses are streamed through unchanged.

The Responses and Messages compatibility routes pass their converted object
and sanitized headers directly into the Chat handler. They do not serialize the
converted payload into an intermediate `Request` or make the Chat handler parse
it again. Response conversion remains bounded and streaming where the
compatibility contract permits it.

## Shared request setup

Request parsing, authentication configuration, routing metadata, and provider
instances are reused within one request. Common transformations use single-pass
iteration and avoid intermediate request objects. Bounded fan-out operations
start independent subrequests concurrently and settle failures independently.

Optional `llm_proxy` response metadata avoids `clone()` and reads a JSON chat
body once. A body beyond the 5 MiB metadata budget is forwarded unchanged by
replaying the bytes already read before the untouched remainder. Malformed or
non-object JSON similarly replays the original bytes.

Vertex AI memoizes parsed service-account JSON and Base64 Gateway credentials
in isolate-local maps keyed by the raw secret string. The cache is a pure
function of operator configuration: it stores no request data, resets when
the secret value changes or the isolate is recycled, and exists only to avoid
re-parsing multi-kilobyte key material on every credential read.

## Bounded model aggregation

Model discovery reads at most 1 MiB from one provider, queries every configured
provider concurrently, retains at most 1,000 models per provider, and caps the
serialized aggregate model entries at 4 MiB. A truncated response includes
`X-Proxy-Models-Truncated: true`. The provider set is bounded by the fixed
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
mode, the parsed `/key/...` selection, and a validated normalized provider
filter — so clients cannot create arbitrary cache partitions or poison another
scope. Requests that carry `cf-aig-*`
Gateway tuning headers or `Cache-Control: no-store` bypass the cache entirely;
`Cache-Control: no-cache` skips the read but refreshes the entry. Aggregates
with a failed provider or a truncated result are served but never stored, so a
transient upstream outage cannot pin a degraded list for the full TTL. The
stored copy's `Cache-Control` header only encodes the internal TTL. Served
responses replace it with `private, no-store`, keeping responses issued under
`Authorization` out of shared HTTP caches. Cache writes ride
`ctx.waitUntil`, keeping the store off the response's critical path.

Caching is an optional optimization. If Cache API `open`, `match`, or `put`
fails or the Cache API is unavailable in the deployment environment, the route
logs the failed cache operation and continues with an uncached provider
fan-out. This includes environments where Cloudflare Access makes the Cache API
unavailable.

Cache API operations are inert on `*.workers.dev`, so
`MODELS_CACHE_TTL_SECONDS` requires a custom domain to reduce `/models` fan-out.

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

Run `npm run bench` to exercise the CPU-only request-building, routing, and
Responses, Messages, and metadata SSE transformation hot paths.

Benchmarks are diagnostic rather than correctness gates because absolute
results vary by machine. Record the command, Node version, machine, benchmark
name, mean, and variance when using a result for a performance decision.
Compare only the same input and environment. Benchmarks diagnose performance;
Worker-runtime tests and coverage enforce correctness.

Production evaluation uses Workers CPU time rather than handler latency alone:
handler latency includes upstream wait time and can move independently of local
CPU consumption.
`wrangler.jsonc` sets `limits.cpu_ms` to 1,000 ms as an invocation guardrail;
network wait time does not consume that CPU budget. Sustained limit errors must
be investigated with Workers CPU metrics and profiling before raising it.

## References

- [Cloudflare Workers CPU time and limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)
- [Cloudflare Workers Streams API](https://developers.cloudflare.com/workers/runtime-apis/streams/)
- [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
