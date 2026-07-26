# Request-path Performance

## Scope

The proxy normally spends most of its wall time waiting for upstream model
providers. Local CPU work still matters because it runs before each subrequest
and counts against the Worker's CPU budget. Optimizations therefore target
parsing and allocation on the authenticated request path without
buffering upstream responses or sharing request state globally.

## Decision priorities

For implementations that preserve the same behavior, security, and documented
limits, evaluate choices in this order:

1. Minimize expected Worker CPU time across the full request distribution.
2. Prefer the simplest design when expected CPU cost is equivalent or
   unmeasured.
3. Improve wall-clock latency and memory use without moving unnecessary work
   into the Worker.

Cloudflare measures CPU time while Worker code is actively executing; time
spent awaiting network or storage I/O does not count. Concurrency can reduce
wall-clock latency, but it does not make parsing, transformation, logging, or
other local work free. Similarly, `ctx.waitUntil()` removes eligible work from
the response's critical path but does not eliminate that work's CPU cost.

The common request path therefore follows these rules:

- Forward request bodies and return upstream response streams directly when the
  route contract does not require inspecting or changing their contents.
- Parse, validate, filter, and serialize a payload no more than required by the
  selected route. Reuse request-scoped intermediate values instead of
  reconstructing or cloning them.
- Defer provider-specific conversion, aggregation, diagnostics, and other
  route-specific work until routing establishes that it is necessary.
- Keep lookup work indexed and iteration bounded. Do not add speculative
  precomputation, caching, or abstraction whose common-path overhead lacks a
  measured or contract-driven justification.
- Keep buffering, item counts, attempts, and time bounded independently of
  performance measurements. Independent subrequests run concurrently unless a
  documented platform or upstream requirement justifies a cap.

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

The runtime-normalized client URL is scanned once for its path and the result is
shared by the request logger and request middleware; the common path does not
invoke the URL parser. Authentication reuses the already-read configured key
list, while still hashing the candidate and comparing every configured digest.
Structured log construction, provider parameter filtering, provider header
forwarding, and compatibility conversion use single-pass loops or `Headers`
objects directly so common requests do not allocate intermediate entry and
filter arrays.

Virtual-model retries iterate the bounded candidate configuration directly
instead of expanding it into a duplicate attempt array. Status connectivity
checks start all configured credential subrequests concurrently without a local
scheduling loop or application-level concurrency cap.

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
results vary by machine. Results are comparable only for the same benchmark,
runtime version, input, and machine. The Worker-runtime test suite and coverage
thresholds enforce correctness.

Production evaluation uses Workers CPU time rather than handler latency alone:
handler latency includes upstream wait time and can move independently of local
CPU consumption.

## References

- [Cloudflare Workers CPU time and limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)
- [Cloudflare Workers Streams API](https://developers.cloudflare.com/workers/runtime-apis/streams/)
