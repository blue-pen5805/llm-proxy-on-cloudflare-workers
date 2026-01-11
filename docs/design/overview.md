# Design Documentation Overview

## Mission Statement

The `cloudflare-workers-llm-proxy` project provides a unified, resilient, and high-performance entry point for various LLM providers. By leveraging the Cloudflare edge, it simplifies LLM integration for applications while enhancing reliability through advanced key management.

## Core Design Principles

1.  **Seamless Abstraction**: Hide provider-specific complexities behind an OpenAI-compatible interface.
2.  **Global Resilience**: Use distributed state management for reliable key rotation.
3.  **Transparent Observability**: Native integration with monitoring tools like AI Gateway.
4.  **Modular Extensibility**: A pipeline-based architecture that grows with its features.

## Feature-Specific Design Documents

To understand the architecture and design of specific capabilities, please refer to the following documents:

### Core Architecture

- [**Middleware Pipeline**](./features/middleware_pipeline.md): The structural design of the request processing chain.
- [**Path Handling & Normalization**](./features/path_handling.md): Describes how request paths are initialized, decoded, and sanitized.
- [**Provider Abstraction**](./features/provider_abstraction.md): How the proxy translates between various LLM backends and ensures OpenAI compatibility.

### Reliability & Management

- [**Stateful Key Rotation**](./features/key_rotation.md): Deep dive into the Durable Objects and SQLite based rotation mechanism.
- [**Security & Configuration**](./features/security_config.md): Patterns for authentication and environment-based configuration.

### Integration & Observability

- [**AI Gateway Integration**](./features/ai_gateway.md): The design of the transparent proxy bridge to Cloudflare AI Gateway.
- [**Monitoring & Diagnostics**](./features/monitoring_diagnostics.md): The architecture of the `/status` system and health checks.
- [**Custom OpenAI-Compatible Endpoints**](./features/custom-openai-endpoints.md)
