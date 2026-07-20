# Roadmap Candidates

This document records plausible expansions of the project boundary. Items here
are not commitments and have no implied order. Before implementation, each item
requires a design document that resolves the open questions below and explains
how the proposal follows the [project principles](docs/project-principles.md).

## Health-aware credential traffic management

Extend key selection beyond random and coordinated round-robin so it can react
to rate limits, authentication failures, capacity, or operator-defined weights.

Design requirements:

- keep selection policy, retry policy, and observed credential health as
  separate concepts;
- distinguish terminal authentication failures from transient throttling and
  transport failures;
- define cooldown, recovery, state expiry, and concurrency behavior;
- avoid adding shared coordination that becomes an unnecessary request-path
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
