# Project Principles

These principles define the proxy's architecture, scope, and implementation
constraints.

## Minimize Worker CPU time, then complexity

For designs that satisfy the documented behavior and security contracts,
minimizing Cloudflare Workers CPU time is the first implementation priority.
Minimize active work across the complete request path: perform only work needed
by the selected route, avoid repeated parsing, serialization, copying, and
lookup construction, and preserve request and response streams whenever their
contents do not need to change. Network wait time is not Worker CPU time and
must not be confused with local processing cost.

When alternatives have equivalent expected CPU cost, choose the simplest
implementation: the fewest transformations, states, branches, layers, and
background tasks needed to express the contract. Additional abstraction,
caching, or precomputation requires evidence that it reduces CPU across the
expected workload or is necessary for correctness, security, or a documented
operational limit. A local optimization is not a net improvement when its
coordination, invalidation, or common-path overhead costs more than it saves.

Performance work remains measurable and reviewable. Use representative
hot-path benchmarks and production Workers CPU metrics where available, while
keeping tests and explicit resource bounds as correctness gates.

## Build the smallest useful proxy

The Worker is a narrow routing and credential boundary between clients,
Cloudflare AI Gateway, and upstream LLM providers. Its behavior is limited to
routing, authentication, compatibility, safety, and operation of that boundary.

Clients or dedicated services own prompt management, conversation state,
agents, RAG, tool execution, and other application concerns.

## Preserve requests and responses by default

Request and response streams pass through without parsing, buffering, wrapping,
or rewriting unless a documented route requires it. Pass-through and AI Gateway
REST routes follow their upstream wire contracts within the security boundary.

Permitted mutations have a specific purpose: remove proxy credentials and
unsafe transport metadata, select the upstream destination, add the selected
upstream credential, or perform the minimum declared compatibility conversion.
Payload enrichment, invented defaults, provider normalization, and
proxy-specific response envelopes require an explicit contract.

## Keep compatibility narrow and explicit

OpenAI-compatible routes adapt selected operations and do not provide a
provider-independent LLM abstraction. Each provider independently declares
support for pass-through, chat translation, model discovery, and AI Gateway
routing. One capability does not imply another.

Adapters filter known parameters or make the smallest structural conversion
required by an upstream API. Provider-specific semantics and material
differences are visible to callers.

The project does not own model definitions. Model aggregation consumes provider
lists and performs only the conversion and provider prefixing required by the
proxy API. Operator-supplied static lists are configuration, not a
project-maintained catalog.

## Use AI Gateway and Cloudflare platform capabilities

When AI Gateway is configured, it owns Gateway policy for analytics, caching,
retry, fallback, cost controls, and provider credential management. The proxy
constructs, authenticates, and streams Gateway requests.

Workers Logs and traces provide observability. Deployment-level controls such
as Access or WAF provide perimeter policy. The proxy does not duplicate these
platform capabilities.

## Make routing and policy operator-controlled

Built-in adapters and deployment configuration define upstream destinations.
Untrusted clients cannot use the Worker as an open relay or select arbitrary
origins.

Operator configuration explicitly defines any behavior that affects where or
how a request executes. Such behavior is observable and bounded. The proxy does
not silently substitute providers or credentials when doing so can affect
semantics, cost, data handling, or failure behavior.

## Treat credentials as the primary security boundary

Production authentication fails closed. Client-facing proxy credentials are
removed before forwarding, and only credentials required by the selected
provider or Gateway route are added. Cookies, hop-by-hop headers, client-network
metadata, and credential-like query parameters do not cross the boundary.

Configuration files and Worker bindings are operator-controlled inputs. Logs,
errors, diagnostics, and deployment tooling do not disclose credential values
or stable derived identifiers.

## Stream first and bound exceptional buffering

Ordinary request paths preserve streaming and propagate cancellation. Buffering
occurs only when routing or conversion requires the body. Aggregated and
diagnostic work has explicit byte, item, attempt, and time limits.

Independent subrequests start concurrently without an application-level
concurrency cap by default. Add a cap only when a documented platform or
upstream contract requires one or concrete production evidence shows that
unrestricted fan-out is unsafe.

Fan-out operations such as model discovery and status checks isolate provider
failures and return partial results when their public contract allows it. A slow
or malformed upstream cannot cause unbounded Worker resource use.

## Keep state request-scoped and persistent state minimal

Request-specific environment, routing, logging, provider, and key-selection
state is request-scoped. Mutable module state does not communicate between
requests.

The proxy has no cross-request persistent state.

## Make observability structured and content-minimal

Structured events describe routing, selected credential slots, upstream
outcomes, latency, and bounded failures. Event correlation excludes request
bodies, response bodies, arbitrary headers, raw query strings, credential
fragments, and stable credential fingerprints.

Operational visibility describes proxy behavior without copying customer LLM
traffic.

## Keep claims, code, tests, and documentation aligned

Provider capabilities, configuration names, route behavior, security
properties, and limits are explicit contracts. Each capability is verified
independently, and partial or best-effort behavior is documented without
inferring parity from a shared adapter.

Designs minimize transformations and state, assign policy to the appropriate
platform layer, and are verifiable at the proxy boundary.
