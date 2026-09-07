# Request Processing

## Middleware model

The Worker uses a composed middleware chain to keep authentication, path
rewriting, Gateway selection, and route handlers independent. A shared
`MiddlewareContext` carries only request-scoped state: the request, Worker
environment, execution context, normalized path, optional key selection,
optional AI Gateway client, and the request's provider registry.

`composeMiddleware` enforces single forward traversal. Calling `next()` twice
rejects, and reaching the end of the chain produces a not-found error.

The internal field is named `pathname`, but it stores the URL suffix after the
origin, including the query string. This preserves non-authentication query
parameters on pass-through requests.

## Ordered stages and path rewriting

The order in `src/index.ts` is behaviorally significant:

1. `loggingMiddleware` guarantees a request-start record and records final
   response status and request latency. Route handlers emit the start record
   earlier when safe endpoint-specific metadata becomes available.
2. `errorMiddleware` converts known application errors to JSON and redacts
   unexpected error details from clients. Because it wraps CORS handling, its
   responses include the applicable cross-origin headers.
3. `corsMiddleware` answers preflight requests immediately and adds CORS headers
   to actual cross-origin responses.
4. `requestMiddleware` initializes the origin-relative path, including its
   query string.
5. `authMiddleware` removes credential-like query parameters and authenticates
   header credentials unless development mode is enabled on a locally running
   Worker.
6. `apiKeyPathMiddleware` extracts and removes an optional `/key/...` prefix.
   Authentication runs first so malformed selections cannot reveal the reserved
   prefix to an unauthenticated client.
7. `providerRegistryMiddleware` validates custom endpoint configuration and
   attaches the provider registry for that configuration to the request.
   Registries contain no request state and are reused across requests.
8. `aiGatewayMiddleware` selects the default or path-specific Gateway and
   removes an optional `/g/<name>` prefix. A prefix without
   `CLOUDFLARE_ACCOUNT_ID` fails with HTTP 400.
9. `routerMiddleware` requires the provider registry established by the prior
   stage, resolves the request to a typed route without invoking a handler, and
   then executes that route. Resolution preserves route priority and rejects an
   extracted key selection when the selected route has no key-selection
   contract. Execution owns handler invocation and endpoint-specific logging.

For example, after successful authentication:

```text
/key/1-3/g/production/openai/v1/models?api_key=untrusted&region=us
    -> query: /key/1-3/g/production/openai/v1/models?region=us
    -> key selection: {start: 1, end: 3}
    -> Gateway: production
    -> provider: openai
    -> upstream path: /v1/models?region=us
```

The preflight short circuit intentionally occurs before authentication. Other
routes authenticate before dispatch. Provider handlers remove all headers
accepted as proxy credentials and then add the selected provider credential.
For routed requests, `request.started` is emitted after bounded parsing needed
to identify the endpoint, provider, and model, but before credential selection
and upstream I/O. The outer logging middleware supplies a method/path-only
fallback for requests that return before route metadata becomes available.

Inference dispatch awaits the provider's operation before protocol conversion
or inference I/O. OpenCode resolution performs a bounded, credential-free
catalog lookup; static providers resolve without network access. The selected operation supplies both request construction and
response handling for direct and Gateway transport. Missing operations without a
conversion fallback return HTTP 400. Model discovery and diagnostics skip
providers without a declared model-list operation.

## Key prefix and route matching

The leading forms `/key/N`, `/key/N-M`, `/key/N-`, and `/key/-M` are supported.
Indices are zero-based non-negative safe integers, and a range start cannot
exceed its end. Malformed values in the reserved `/key/` namespace return HTTP 400. Parsing occurs only at the beginning of the path. The provider handler
resolves the recorded selection after it knows the configured key count.

Explicit selection is supported only by OpenAI-compatible Chat Completions,
Responses, Anthropic-compatible Messages, model aggregation, and registered
provider pass-through routes. `/ping`, `/status`, AI Gateway REST and
compatibility pass-through routes, the Universal Endpoint, and unknown routes
reject a leading key-selection prefix with HTTP 400.

The router recognizes the documented versioned and unversioned compatibility
aliases. Provider pass-through requires `/<provider>/` with a trailing slash
after the provider name and accepts only `GET`, `HEAD`, `POST`, `PUT`, `PATCH`,
or `DELETE`; other methods fail with HTTP 405 before provider request
construction. Gateway Compatibility matches only
`POST /compat/chat/completions`, and the Universal Endpoint matches only
`POST /`, when a Gateway context exists. Compatibility POST routes match the
URL path independently of the query string, as the GET and HEAD routes do.

The account-level AI Gateway REST API matches only `POST /ai/run`,
`POST /ai/v1/chat/completions`, `POST /ai/v1/responses`, and
`POST /ai/v1/messages` when a Gateway context exists. Other methods, suffixes,
and query-bearing variants in the reserved `/ai` namespace return HTTP 404.

Path normalization is routing logic, not a general defense against malicious
upstream paths. Provider base URLs remain fixed by code or trusted deployment
configuration. The complete public route contract is in
[HTTP API and routing](../../api.md).

## Request-scoped environment and failures

The entry point runs the chain inside `Environments.run`, backed by
`AsyncLocalStorage`. Provider instances and utilities can read the current
`Env` without mutable module-level request state. After authentication,
`providerRegistryMiddleware` creates one `ProviderRegistry` in that scope.
Invalid custom endpoint configuration therefore becomes a safe HTTP 503 without
being disclosed to unauthenticated requests. Routing reads provider names
without eagerly constructing adapters; handlers reuse lazily created instances.

Handlers may return upstream responses directly or throw application errors.
The outer error boundary preserves public messages for known errors. Unknown
values are logged and converted to a generic HTTP 500 JSON response.
OpenAI-compatible local failures use the OpenAI error object; Messages routes
use the Anthropic error object. `HEAD` health and model routes execute their
`GET` contract and discard the response body.

JSON-inspecting handlers share a bounded HTTP body reader. Invalid or oversized
Content-Length values and streamed byte-limit violations release the rejected
body; cancellation failure does not replace the validation error. Upstream JSON
readers pass response headers and streams directly to the same reader instead
of constructing an intermediate Request.

The Responses and Messages compatibility implementations are organized by
protocol stage. Each has a request translator, a bounded JSON response
translator, an SSE stream translator, and a small handler that declares its
protocol adapters.
`compatibility_handler.ts` owns their common bounded request parsing, validation,
lazy Chat conversion, and JSON/SSE response dispatch. Protocol adapters retain
their own validation errors and wire-format transformations. Same-protocol
endpoints bypass these translators; the converters run lazily only for candidates
lacking a matching capability.
Their top-level modules are stable facades for
the route handler and stream-conversion entry points.

The shared SSE record reader uses line state for LF, CRLF, and CR, as defined by
the [SSE parsing standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).
A CR at the end of a network chunk is held until the next chunk or EOF so a
split CRLF remains one line ending. Original record separators are retained for
metadata enrichment. Record byte limits exclude the terminating line endings
and are independent of network chunk boundaries. Unterminated final records
are passed to the protocol-specific EOF handler.

## References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
