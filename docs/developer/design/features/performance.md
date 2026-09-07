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
object is passed to one resolved operation without another parse. Filtering is
owned by that operation; the default filter and narrowed parameter sets are
prepared outside request execution. Protocol resolution occurs once per concrete
candidate, and authentication is built once per attempted credential. Prepared
direct requests are sent without another header merge. Gateway attempts are lazy:
only an attempted credential incurs native conversion and serialization.
Chat-format upstream responses can pass through unchanged. Native inference
uses bounded JSON or incremental stream conversion as described in
[Native inference](native_inference.md).

Responses and Messages pass the parsed request to shared routing. A matching
native capability preserves protocol fields and streams the response without
conversion. Otherwise the lazy converter runs once and caches its Chat object
for subsequent fallback candidates. The converted object and sanitized headers
are passed directly to provider request construction. They do not serialize the
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

Automatic cooldown selection scans the ascending eligible-slot list from the
selected rotation phase and wraps to its first entry. It requires no secondary
membership set or scan across cooling slots.

## Bounded model aggregation

Per-provider byte and count bounds plus an aggregate byte bound prevent
concurrent discovery from accumulating unbounded responses. Non-successful
responses are discarded before conversion; reaching one provider's count limit
does not skip later providers. Retries share a provider deadline. Exact limits
and truncation behavior are defined in the [Models
API](../../../user/api/openai-compatible.md#models).

## Model aggregate caching

Complete model aggregates use the dedicated `llm-proxy-models` Cache API cache
to replace repeated provider fan-out with one cache read. TTLs, request
controls, and response headers follow the [Models
API](../../../user/api/openai-compatible.md#models).

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

The Cache API is per-datacenter: each Cloudflare location warms its own entry,
and a configuration change (for example adding a provider key) can serve a
stale list from an already-primed datacenter for up to the TTL. The short
default TTL bounds that staleness without a global purge mechanism.

## Provider route index

`ProviderRegistry` snapshots built-in and custom provider names when a registry
is created. The built-in registry is reused across requests; custom registries
are weakly cached by the validated configuration object's identity. Provider
methods read the active request environment, so registry reuse does not retain
another request's selected credentials or routing decisions. Route matching
reads that immutable index,
and custom-provider lookup uses a map. It does not rebuild provider-name arrays
or scan custom endpoint configuration for each lookup.

## Benchmarking

[Development and verification](../../development.md#performance-measurement)
defines benchmark commands and comparison requirements. Production evaluation
uses Workers CPU time; handler latency also includes upstream wait.
`wrangler.jsonc` sets `limits.cpu_ms` to 1,000 ms as an invocation guardrail.
Investigate sustained limit errors with CPU metrics before raising it.

## References

- [Cloudflare Workers CPU time and limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)
- [Cloudflare Workers streaming best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/#stream-request-and-response-bodies)
- [Cloudflare Workers Streams API](https://developers.cloudflare.com/workers/runtime-apis/streams/)
- [Cloudflare Workers Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
