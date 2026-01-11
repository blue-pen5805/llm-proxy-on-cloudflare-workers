# Middleware Pipeline Design

## Philosophy

The core request/response handling is designed using the **Pipe-and-Filter** architectural pattern, implemented as a composable middleware chain. This approach decouples cross-cutting concerns from the core routing and provider logic, allowing for a highly maintainable and extensible system.

## Structural Design

The pipeline is a sequential chain where each component (middleware) can:

- Inspect and modify the request before passing it to the next component.
- Intercept the response from the downstream components and modify it.
- Short-circuit the pipeline by returning a response immediately (e.g., in case of unauthorized access).

### Design Benefits

- **Separation of Concerns**: Each middleware has a single responsibility (e.g., `authMiddleware` only handles security).
- **Decoupled Context**: The `MiddlewareContext` object carries essential state (request, env, pathname) through the pipeline without polluting global scope.
- **Predictable Flow**: The deterministic order of execution ensures that security and environment setup always occur before routing.

## Pipeline Components

- **Fault Tolerance (`errorMiddleware`)**: Acts as the outermost layer to catch all unhandled exceptions and transform them into standardized JSON error responses, preventing worker crashes and ensuring client compatibility.
- **Request Initialization (`requestMiddleware`)**: The first stage that decomposes the `context.request` into `context.pathname` and initializes the `Environments` utility, providing a consistent context for downstream middlewares.
- **Resource Routing Paths (`apiKeyPathMiddleware`)**: Extracts API key indices or ranges from specific path parameters (e.g., `/key/i/`) and updates `context.pathname` to allow standard routing to proceed.
- **Security Enforcement (`authMiddleware`)**: Validates client-provided keys against the configured `PROXY_API_KEY`. It also sanitizes the `pathname` by removing sensitive authorization query parameters (`cleanPathname`).
- **Observability Bridge (`aiGatewayMiddleware`)**: Detects and modifies requests intended for Cloudflare AI Gateway, abstracting the complexity of gateway-specific hosts.
- **Dispatch (`routerMiddleware`)**: The final stage that performs semantic routing to specialized request handlers.

## References

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Fetch API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
