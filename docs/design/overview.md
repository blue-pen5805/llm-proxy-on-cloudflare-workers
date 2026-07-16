# Architecture Overview

## Scope

The Worker presents one authenticated edge endpoint for multiple LLM APIs. It
supports three request styles: OpenAI-compatible chat and model routes,
provider-specific pass-through routes, and Cloudflare AI Gateway routes.

This documentation describes the current implementation. User-facing commands
and endpoint examples live in the [documentation index](../index.md).

## Request flow

```mermaid
flowchart LR
  Client --> Error[Error boundary]
  Error --> Request[Request parsing]
  Request --> CORS[CORS handling]
  CORS --> Key[Key-prefix parsing]
  Key --> Auth[Proxy authentication]
  Auth --> Gateway[AI Gateway selection]
  Gateway --> Router[Route dispatch]
  Router --> OpenAI[OpenAI-compatible handlers]
  Router --> Pass[Provider pass-through]
  Router --> Health[Health and status]
  OpenAI --> Adapter[Provider adapter]
  Pass --> Adapter
  Gateway --> AIG[Cloudflare AI Gateway]
  Adapter --> Upstream[LLM provider]
  AIG --> Upstream
```

The Worker stores the active `Env` in request-scoped `AsyncLocalStorage` so
configuration helpers do not depend on mutable module-level request state.
Multi-key rotation is either random or coordinated by a SQLite-backed Durable
Object. Provider and proxy credentials are kept separate when requests are
forwarded.

## Design boundaries

- The proxy is an adapter and router, not a complete normalization layer for
  every provider feature.
- Pass-through routes deliberately preserve provider-specific contracts.
- Model aggregation and status checks are best-effort diagnostics, not
  transactional health guarantees.
- AI Gateway supplies gateway concerns such as analytics and caching; this
  Worker constructs and authenticates Gateway requests but does not reproduce
  those features.
- JSONC files are local inputs. Production configuration reaches the Worker as
  secret environment bindings.

## Detailed design

### Request processing

- [Middleware pipeline](features/middleware_pipeline.md)
- [Path handling and normalization](features/path_handling.md)
- [Security and configuration](features/security_config.md)

### Provider behavior and reliability

- [Provider abstraction](features/provider_abstraction.md)
- [Custom OpenAI-compatible endpoints](features/custom-openai-endpoints.md)
- [Key rotation](features/key_rotation.md)

### Cloudflare integration and diagnostics

- [AI Gateway integration](features/ai_gateway.md)
- [Monitoring and diagnostics](features/monitoring_diagnostics.md)
- [Request-path performance](features/performance.md)

## Authoritative implementation points

| Concern                         | Source                       |
| ------------------------------- | ---------------------------- |
| Middleware order                | `src/index.ts`               |
| Route table                     | `src/middlewares/router.ts`  |
| Built-in providers              | `src/providers.ts`           |
| Configuration shape             | `schemas/config-schema.json` |
| Worker bindings and migrations  | `wrangler.jsonc`             |
| Secret and key-selection policy | `src/utils/secrets.ts`       |
