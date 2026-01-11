# Path Handling & Request Normalization

## Overview

The proxy employs a multi-stage path processing strategy to handle various request formats, including specific resource targeting (API key indices) and standardized routing. This logic is decoupled across multiple middlewares to ensure a clear separation of concerns and maintainability.

## Processing Pipeline

The path normalization happens in three distinct stages within the [Middleware Pipeline](middleware_pipeline.md):

### 1. Basic Initialization (`requestMiddleware`)

The very first stage extracts the relative pathname from the incoming `context.request` and stores it in `context.pathname`. At this stage, the path is kept exactly as it appeared in the URL.

- **Purpose**: Provides a common baseline for all subsequent middlewares.
- **Transformation**: `https://api.proxy.com/key/5/v1/chat/completions?apikey=...` → `/key/5/v1/chat/completions?apikey=...`

### 2. Parameter Extraction & Rewriting (`apiKeyPathMiddleware`)

This middleware looks for specific resource identifiers embedded in the path.

- **Target Patterns**:
  - `/key/{index}/`: Selects a specific API key by its 0-based index.
  - `/key/{start}-{end}/`: Selects a range or subset of keys for rotation.
- **Action**: It parses the index/range into `context.apiKeyIndex` and **removes** the prefix from `context.pathname`.
- **Transformation**: `/key/5/v1/chat/completions` → `/v1/chat/completions` (with `apiKeyIndex: 5`)

### 3. Sanitization & Normalization (`authMiddleware`)

The final path processing stage ensures that sensitive authentication data is removed before internal routing and upstream proxying.

- **Purpose**: Strips authentication-related query parameters (like `?apikey=...`) from the pathname to prevent them from leaking into logs or upstream sub-requests.
- **Mechanism**: Utilizes `cleanPathname` to remove parameters defined in `AUTHORIZATION_QUERY_PARAMETERS`.
- **Transformation**: `/v1/chat/completions?apikey=secret` → `/v1/chat/completions`

## Advanced Routing Patterns

After the normalization pipeline, the `routerMiddleware` performs semantic routing based on the final `context.pathname`.

### 1. Cloudflare AI Gateway Intercept (`/g/...`)

If a path starts with `/g/{gateway-name}/`, the `aiGatewayMiddleware` intervenes before the standard routing logic.

- **Action**: It extracts the `{gateway-name}`, initializes a specialized `aiGateway` context, and **strips** the `/g/{name}` prefix from the pathname.
- **Example**: `/g/my-gateway/v1/chat/completions` → `/v1/chat/completions` (with AI Gateway integration active).

### 2. Explicit Provider Proxying (`/{provider}/...`)

The proxy allows direct access to specific providers by using their name as a path prefix.

- **Action**: The router identifies prefixes matching registered providers (e.g., `/openai/`, `/anthropic/`, `/google-ai-studio/`).
- **Rewrite**: The prefix is removed, and the remaining path is forwarded to the provider's base URL.
- **Example**: `/openai/v1/chat/completions` → proxied to OpenAI's base URL with path `/v1/chat/completions`.

### 3. AI Gateway Compatibility Layer (`/compat/...`)

A special endpoint used exclusively with AI Gateway integration for legacy or specific compatibility needs.

- **Condition**: Only active if `aiGateway` context is present.
- **Routing**: Routes paths starting with `/compat/` to the `compat` handler, which utilizes AI Gateway's specific compatibility features.

### 4. Standard OpenAI-Compatible Routing

Standard endpoints are handled globally, often relying on the `model` field within the request body to resolve the target provider.

- **Supported Paths**:
  - `/v1/chat/completions` (and `/chat/completions`)
  - `/v1/models` (and `/models`)

## Summary of Path Rewriting Order

1.  **Extract Resource**: `/key/5/v1/chat/completions` → `/v1/chat/completions` (Middleware: `apiKeyPath`)
2.  **Intercept Gateway**: `/g/my-gate/v1/chat/completions` → `/v1/chat/completions` (Middleware: `aiGateway`)
3.  **Final Routing**: Determine handler based on the remaining `/v1/chat/completions`.

## references

- [Middleware Pipeline Design](middleware_pipeline.md)
- [Authentication & Security Design](security_config.md)
