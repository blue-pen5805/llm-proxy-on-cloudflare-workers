# Architecture Overview

## Scope

The Worker presents one authenticated edge endpoint for multiple LLM APIs. It
supports OpenAI-compatible Chat Completions, Responses, Anthropic-compatible
Messages, model aggregation, provider-specific pass-through, and Cloudflare AI
Gateway routes.

User-facing commands and endpoint examples live in the
[documentation index](../../index.md). Architecture and scope follow the
[project principles](../project-principles.md).

## Request flow

```mermaid
flowchart LR
  Client --> Logging[Lifecycle logging]
  Logging --> Error[Error boundary]
  Error --> CORS[CORS handling]
  CORS --> Request[Request parsing]
  Request --> Auth[Proxy authentication]
  Auth --> Key[Key-prefix parsing]
  Key --> Registry[Provider registry]
  Registry --> Gateway[AI Gateway selection]
  Gateway --> Router[Route dispatch]
  Router --> OpenAI[OpenAI-compatible handlers]
  Router --> Pass[Provider pass-through]
  Router --> Health[Health and status]
  OpenAI --> Adapter[Provider adapter]
  Pass --> Adapter
  Adapter --> Policy{Gateway policy}
  Policy --> AIG[Cloudflare AI Gateway]
  Policy --> Upstream[LLM provider]
  AIG --> Upstream
```

State and credential isolation are defined in [request
processing](features/request-processing.md#request-scoped-environment-and-failures)
and [security](features/security_config.md).

## Detailed design

### Request processing

- [Request processing](features/request-processing.md)
- [Security and configuration](features/security_config.md)

### Provider behavior and reliability

- [Native inference endpoint selection](features/native_inference.md)
- [OpenCode providers and live protocol selection](features/opencode.md)
- [Provider abstraction](features/provider_abstraction.md)
- [Key rotation](features/key_rotation.md)
- [Virtual models](features/virtual_models.md)

### Cloudflare integration and diagnostics

- [AI Gateway integration](features/ai_gateway.md)
- [Monitoring and diagnostics](features/monitoring_diagnostics.md)
- [Request-path performance](features/performance.md)

## Authoritative implementation points

| Concern                         | Source                       |
| ------------------------------- | ---------------------------- |
| Middleware order                | `src/index.ts`               |
| Route table                     | `src/routing.ts`             |
| Route execution                 | `src/middlewares/router.ts`  |
| Built-in providers              | `src/providers.ts`           |
| Configuration shape             | `schemas/config-schema.json` |
| Worker bindings and migrations  | `wrangler.jsonc`             |
| Secret and key-selection policy | `src/utils/secrets.ts`       |
