# Middleware Pipeline

## Rationale

The Worker uses a composed middleware chain to keep authentication, path
rewriting, Gateway selection, and route handlers independent. A shared
`MiddlewareContext` carries only request-scoped state: the request, Worker
environment, execution context, normalized path, optional key selection,
optional AI Gateway client, and the request's provider registry.

`composeMiddleware` enforces single forward traversal. Calling `next()` twice
rejects, and reaching the end of the chain produces a not-found error.

## Ordered stages

The order in `src/index.ts` is behaviorally significant:

1. `loggingMiddleware` guarantees a request-start record and records final
   response status and request latency. Route handlers emit the start record
   earlier when safe endpoint-specific metadata becomes available.
2. `errorMiddleware` converts known application errors to JSON and redacts
   unexpected error details from clients. Because it wraps CORS handling, it
   returns CORS failures as JSON with the applicable cross-origin headers.
3. `corsMiddleware` answers preflight requests immediately and adds CORS headers
   to actual cross-origin responses.
4. `requestMiddleware` initializes the path, including its query string.
5. `apiKeyPathMiddleware` extracts a `/key/...` prefix.
6. `authMiddleware` removes credential-like query parameters and authenticates
   header credentials unless development mode is enabled on a locally running
   Worker.
7. `providerRegistryMiddleware` validates custom endpoint configuration and
   creates the request-scoped provider registry.
8. `aiGatewayMiddleware` selects the default or path-specific Gateway and
   removes a `/g/<name>` prefix. A prefix without `CLOUDFLARE_ACCOUNT_ID`
   fails with an explanatory HTTP 400.
9. `routerMiddleware` dispatches health, compatibility, OpenAI-compatible,
   provider pass-through, and Universal Endpoint requests. It also rejects an
   extracted key selection with HTTP 400 when the selected route has no key
   selection contract.

The preflight short circuit intentionally occurs before authentication. Other
routes are authenticated before dispatch. Provider handlers remove all headers
accepted as proxy credentials and then add the selected provider credential.
For routed requests, `request.started` is emitted after bounded parsing needed
to identify the endpoint, provider, and model, but before credential selection
and upstream I/O. The outer logging middleware supplies a method/path-only
fallback for requests that return before route metadata becomes available.

## Request-scoped environment

The entry point runs the entire chain inside `Environments.run`, backed by
`AsyncLocalStorage`. Provider instances and utility functions can read the
current `Env` without a global mutable variable, which prevents concurrent
requests in the same isolate from overwriting one another's configuration.
After authentication, `providerRegistryMiddleware` creates one
`ProviderRegistry` inside that scope. Invalid custom endpoint configuration is
therefore converted by the error boundary to a safe HTTP 503 response without
being disclosed to unauthenticated requests. Routing uses provider names without
eagerly constructing adapters, while downstream handlers reuse the lazily
created adapter instances.

## Failure behavior

Handlers may return upstream responses directly or throw application errors.
The outer error boundary preserves public messages for known errors. Unknown
values are logged and converted to a generic HTTP 500 JSON response.
OpenAI-compatible local failures use the OpenAI error object; Messages routes
use the Anthropic error object. `HEAD` health/model routes execute their `GET`
contract and then discard the response body.

## References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
