# Roadmap Candidates

This document records plausible expansions of the project boundary. Items here
are not commitments and have no implied order. Before implementation, each item
requires a design document that resolves the open questions below and explains
how the proposal follows the [project principles](docs/project-principles.md).

## Cross-provider failover

Allow an operator to configure an ordered or policy-driven set of provider/model
targets for a logical model.

Design requirements:

- make fallback explicit in configuration; never silently substitute a provider
  with materially different semantics;
- define eligible failure classes, retry budgets, and behavior after response
  headers or stream data have been emitted;
- account for non-idempotent requests and duplicated upstream work;
- define request and response compatibility requirements between candidates;
- expose each attempt and final selection through structured observability.

## Health-aware credential traffic management

Extend key selection beyond random and coordinated round-robin so it can react
to rate limits, authentication failures, capacity, or operator-defined weights.

Design requirements:

- keep selection policy, retry policy, and observed credential health as
  separate concepts;
- distinguish terminal authentication failures from transient throttling and
  transport failures;
- define cooldown, recovery, state expiry, and concurrency behavior;
- avoid turning a shared Durable Object into an unnecessary request-path
  bottleneck;
- provide diagnostics without exposing credential material or stable derived
  fingerprints.

## Dynamic control plane and administration UI

Support runtime configuration and operational changes without redeploying every
setting through Wrangler.

Design requirements:

- define the control-plane trust boundary, authentication, authorization, and
  audit model before choosing a UI or storage product;
- keep provider credentials out of browser-readable state and ordinary API
  responses;
- provide schema validation, versioning, optimistic concurrency, rollback, and
  safe migration of stored configuration;
- define propagation and consistency guarantees across Worker isolates;
- preserve a file-based bootstrap and recovery path when the control plane is
  unavailable.
