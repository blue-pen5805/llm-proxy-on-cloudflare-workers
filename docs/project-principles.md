# Project Principles

These principles guide implementation, review, and roadmap decisions across the
project. They describe how the proxy should evolve rather than freezing its
current feature set.

## Build the smallest useful proxy

The Worker should remain a narrow routing and credential boundary between
clients, Cloudflare AI Gateway, and upstream LLM providers. New behavior belongs
in the proxy only when it is necessary for routing, authentication,
compatibility, safety, or operation of that boundary.

Prompt management, conversation state, agents, RAG, tool execution, and other
application concerns belong in clients or dedicated services.

## Preserve requests and responses by default

Forward request and response streams without parsing, buffering, wrapping, or
rewriting them unless a documented route requires it. Pass-through and AI
Gateway REST routes should remain as close to their upstream wire contracts as
the security boundary permits.

Permitted mutations must have a specific purpose: remove proxy credentials and
unsafe transport metadata, select the upstream destination, add the selected
upstream credential, or perform the minimum declared compatibility conversion.
Do not enrich payloads, invent defaults, normalize provider behavior, or add a
proxy-specific response envelope without an explicit contract.

## Keep compatibility narrow and explicit

OpenAI-compatible routes are adapters for selected operations, not a
provider-independent LLM abstraction. Each provider independently declares
support for pass-through, chat translation, model discovery, and AI Gateway
routing. Supporting one capability must not imply the others.

Adapters may filter known parameters or make the smallest structural conversion
required by an upstream API. Provider-specific semantics and material
differences should remain visible to callers.

The project does not own model definitions. Model aggregation consumes existing
provider lists and performs only the conversion and provider prefixing required
by the proxy API. Operator-supplied static lists remain configuration rather
than a project-maintained catalog.

## Use AI Gateway and Cloudflare platform capabilities

When AI Gateway is configured, prefer its native facilities for analytics,
caching, retry, fallback, cost controls, and provider credential management over
reimplementing those systems in the Worker. The proxy should construct,
authenticate, and stream Gateway requests while leaving Gateway policy under
operator control.

Apply the same rule to the wider Cloudflare platform: use Workers Logs and
traces for observability and deployment-level controls such as Access or WAF
for perimeter policy. Avoid parallel subsystems with overlapping ownership.

## Make routing and policy operator-controlled

Built-in adapters and deployment configuration define upstream destinations.
Untrusted clients must not turn the Worker into an open relay or select arbitrary
origins.

Behavior that changes where or how a request is executed--including future
fallback, weighting, or health-aware selection--must be explicit in operator
configuration, observable, and bounded. Do not silently substitute providers or
credentials when that can change semantics, cost, data handling, or failure
behavior.

## Treat credentials as the primary security boundary

Production authentication fails closed. Client-facing proxy credentials must be
removed before forwarding, and only credentials required by the selected
provider or Gateway route may be added. Cookies, hop-by-hop headers,
client-network metadata, and credential-like query parameters must not cross the
boundary accidentally.

Configuration files and Worker bindings are operator-controlled inputs. Logs,
errors, diagnostics, and deployment tooling must not disclose credential values
or stable derived identifiers.

## Stream first and bound exceptional buffering

Preserve streaming and propagate cancellation on ordinary request paths. Buffer
only when routing or conversion requires the body, and enforce explicit byte,
item, concurrency, attempt, and time limits on aggregated or diagnostic work.

Fan-out operations such as model discovery and status checks should isolate
provider failures and return useful partial results when their public contract
allows it. They must not turn one slow or malformed upstream into unbounded
Worker resource use.

## Keep state request-scoped and persistent state minimal

Request-specific environment, routing, logging, provider, and key-selection
state must remain request-scoped. Do not use mutable module state to communicate
between requests.

The proxy currently has no cross-request persistent state. Adding persistent
state requires a clear consistency requirement, ownership model, and migration
plan.

## Make observability structured and content-minimal

Emit structured events that explain routing, selected credential slots,
upstream outcomes, latency, and bounded failures. Correlate events without
logging request bodies, response bodies, arbitrary headers, raw query strings,
credential fragments, or stable credential fingerprints.

Operational visibility should describe proxy behavior, not create a second copy
of customer LLM traffic.

## Keep claims, code, tests, and documentation aligned

Treat provider capabilities, configuration names, route behavior, security
properties, and limits as explicit contracts. Verify each capability
independently and document partial or best-effort behavior rather than inferring
parity from a shared adapter.

When choosing between designs that satisfy the same requirement, prefer the one
that performs fewer transformations, introduces less state, delegates more
policy to the appropriate platform layer, and is easier to verify at the proxy
boundary.
