# Virtual Models

## Purpose and boundary

Virtual models give an operator one client-visible model name backed by an
ordered set of concrete provider models. They provide bounded failover and
retry within a request; they do not add cross-request state, semantic
normalization, load balancing, or cost-based routing.

Real providers and custom endpoints take precedence over virtual names. A
virtual model is considered only when the requested `model` does not resolve to
a registered provider selector.

## Configuration model

The [configuration contract](../../../user/configuration.md#virtual-models) defines
names, candidates, retry and timeout bounds, and the acyclic graph limit.
Deployment and runtime validation enforce these bounds without echoing invalid
values. Runtime validation is memoized by both virtual-model and custom-endpoint
configuration because provider shadowing changes cycles and expanded attempts.

Lookups use only configured own properties. Names such as `__proto__` are
ordinary entries and cannot alter the map's prototype.

## Resolution and retries

Candidates run in declaration order. A candidate is retried before the next
candidate is considered. Nested references execute their complete chain; a
retry on the reference restarts that chain.

An attempt advances after:

- HTTP 401, 403, 429, or any 5xx response;
- provider resolution or configuration failure; or
- a network error or configured timeout.

Other HTTP responses return immediately. In particular, retrying an unchanged
request after an ordinary client error would not correct the request and could
hide the useful response behind a later failure.

The decision is made from response status or failure before response bytes are
sent to the client. Losing response bodies are cancelled. A streamed response
is never retried after streaming begins.

`timeout` covers the wait for response headers, not consumption of a valid
stream. For providers with a live protocol catalog, the timeout also bounds
catalog resolution as a separate operation before inference. A timeout on a
virtual-model reference becomes the default for concrete
candidates below it; a more specific nested timeout overrides it. Client
cancellation propagates to the active upstream request and stops the complete
nested retry chain before another credential or candidate is selected.

Each concrete attempt uses its provider's normal parameter filtering,
credential profile, key selection, and direct or AI Gateway routing. An
explicit key index is applied modulo each candidate's key count; an explicit
range is resolved for each attempt. Virtual models cannot bypass provider
configuration or credential requirements.

## Compatibility and side effects

Candidates may support different parameters, streaming behavior, or response
shapes. The proxy validates each candidate independently but does not assert
that candidates are interchangeable. Operators are responsible for composing a
set whose behavior is sufficiently compatible for its clients.

Every attempt is a separate upstream request. A losing provider may already
have billed, logged, or otherwise acted on the request before its failure was
observed. Virtual-model and per-credential retries share this non-idempotency
risk.

## Discovery and diagnostics

Model discovery and virtual-model inspection share the validated routing graph.
Inspection expands references without provider I/O; see the [management
API](../../../user/api/proxy-management.md#virtual-models) for its response.

## Observability

Each attempt emits selection, retry, and final-completion events with the
virtual model, candidate, attempt, timeout, and bounded outcome fields. Request
and response bodies are excluded.

Optional `llm_proxy` response metadata identifies the winning provider, model,
credential slot, and Gateway while retaining the client-requested virtual model
as `requested_model`. AI Gateway metadata follows the same winning-route
boundary. Failed history remains log-only.

## References

- [Configuration](../../../user/configuration.md#virtual-models)
- [Proxy management API](../../../user/api/proxy-management.md#virtual-models)
- [Compatibility response metadata](provider_abstraction.md#compatibility-response-metadata)
- [Project principles](../../project-principles.md)
