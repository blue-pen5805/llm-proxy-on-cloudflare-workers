# Middleware Pipeline

## Rationale

The Worker uses a composed middleware chain to keep authentication, path
rewriting, Gateway selection, and route handlers independent. A shared
`MiddlewareContext` carries only request-scoped state: the request, Worker
environment, execution context, normalized path, optional key selection,
optional AI Gateway client, and the request's provider registry.

`compose` enforces single forward traversal. Calling `next()` twice rejects, and
reaching the end of the chain produces a not-found error.

## Ordered stages

The order in `src/index.ts` is behaviorally significant:

1. `errorMiddleware` converts known application errors to JSON and redacts
   unexpected error details from clients.
2. `requestMiddleware` initializes the path, including its query string.
3. `corsMiddleware` answers preflight requests immediately.
4. `apiKeyPathMiddleware` extracts a `/key/...` prefix.
5. `authMiddleware` removes the `key` query parameter and authenticates the
   original request unless development mode is enabled.
6. `aiGatewayMiddleware` selects the default or path-specific Gateway and
   removes a `/g/<name>` prefix.
7. `routerMiddleware` dispatches health, compatibility, OpenAI-compatible,
   provider pass-through, and Universal Endpoint requests.

The preflight short circuit intentionally occurs before authentication. Other
routes are authenticated before dispatch. Provider handlers remove all headers
accepted as proxy credentials and then add the selected provider credential.

## Request-scoped environment

The entry point runs the entire chain inside `Environments.run`, backed by
`AsyncLocalStorage`. Provider instances and utility functions can read the
current `Env` without a global mutable variable, which prevents concurrent
requests in the same isolate from overwriting one another's configuration. It
also creates one `ProviderRegistry` inside that scope. Routing uses provider
names without eagerly constructing adapters, while downstream handlers reuse
the lazily created adapter instances.

## Failure behavior

Handlers may return upstream responses directly or throw application errors.
The outer error boundary preserves public messages for known errors. Unknown
values are logged and converted to a generic HTTP 500 JSON response.

## References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
