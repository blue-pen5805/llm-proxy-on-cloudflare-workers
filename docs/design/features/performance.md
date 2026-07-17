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

Model discovery reads at most 1 MiB from one provider, queries at most five
providers concurrently, retains at most 1,000 models per provider, and caps the
serialized aggregate model entries at 4 MiB. A truncated response includes
`X-Proxy-Models-Truncated: true`. These limits prevent individually bounded
provider responses from accumulating beyond the Worker's 128 MB isolate limit.
Non-successful upstream responses are not parsed as provider model payloads.

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
