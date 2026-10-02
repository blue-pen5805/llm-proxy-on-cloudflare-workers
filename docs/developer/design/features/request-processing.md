# Request Processing

## Hono application and request state

The Worker exports a typed Hono application. Hono owns middleware composition,
HTTP method/path dispatch, and HEAD response-body suppression. Authentication,
credential isolation, CORS policy, and protocol translation remain explicit
proxy policies rather than framework defaults.

The application has two stages. The entry application in `src/index.ts` matches
a constant `/` path so every request enters the common middleware, including
paths containing encoded line separators. It prepares and authenticates the
original request without Hono decoding its path for entry-stage matching.
The routing application in `src/routing.ts`
receives the same original Request and its prepared state. Its `getPath` reads
the prepared path, so route matching happens after authenticated prefix parsing
without constructing another Request or touching its body. Both Hono route
tables are constructed once per isolate and contain no request-specific values.

The entry application's typed `proxy` Context variable holds `ProxyRequestState`:
the Request, Worker bindings, execution context, normalized path, optional key
selection, optional AI Gateway client, and provider registry. The routing stage
receives `RoutedRequestContext`, which requires the provider registry. Protocol
handlers consume this state directly rather than depending on Hono response or
body-parsing helpers.

The internal field `pathname` stores the URL suffix after the origin, including
the query string. Hono route matching uses only the path component; upstream
forwarding retains non-authentication query parameters with their original
encoding and order. Gateway REST routes additionally require an exact suffix,
so a query-bearing REST path is rejected.

## Ordered stages and path rewriting

The order in `src/index.ts` is behaviorally significant:

1. `loggingMiddleware` guarantees a request-start record and records final
   response status and request latency. Route handlers emit the start record
   earlier when safe endpoint-specific metadata becomes available.
2. Hono's `onError` uses `errorResponse` for Error instances. The
   `errorMiddleware` boundary also contains non-Error thrown values. Both use
   the same protocol-specific JSON envelope, redact unexpected details, and
   apply the applicable CORS headers.
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
9. The entry application requires the provider registry and dispatches to the
   Hono routing application. Its method/path declarations own handler invocation
   and endpoint-specific logging. Namespace guards preserve reserved-route
   priority; handlers reject key selection when the route has no such contract.
   The final provider route resolves names only through the operator's registry.

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

Hono matches the prepared path to a handler. The handler rejects a key prefix
when its route cannot consume a provider credential. Prefix syntax,
methods, aliases, and reserved namespaces are defined in [HTTP API and
routing](../../../user/api/overview.md).

Path normalization is routing logic, not a general defense against malicious
upstream paths. Provider base URLs remain fixed by code or trusted deployment
configuration.

## Request-scoped environment and failures

The outer Hono middleware runs request processing inside `Environments.run`,
backed by `AsyncLocalStorage`. Provider instances and utilities can read the current
`Env` without mutable module-level request state. After authentication,
`providerRegistryMiddleware` attaches the configuration-specific
`ProviderRegistry` to the request.
Invalid custom endpoint configuration therefore becomes a safe HTTP 503 without
being disclosed to unauthenticated requests. Routing reads provider names
without eagerly constructing adapters; handlers reuse lazily created instances.

Handlers may return upstream responses directly or throw application errors.
The outer error boundary preserves public messages for known errors. Unknown
values are logged and converted to a generic HTTP 500 JSON response.
OpenAI-compatible local failures use the OpenAI error object; Messages routes
use the Anthropic error object. Hono executes `HEAD` using the matching `GET`
handler and suppresses the response body. The raw Request retains its `HEAD` method, so provider pass-through sends
`HEAD` upstream.

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
split CRLF remains one line ending. A known terminal record whose blank line
ends at that CR can close immediately without waiting for a possible LF.
Terminal probes run only at that boundary, after the record byte limit is
checked; normal parsing still validates the terminal event. Original record separators are retained for
metadata enrichment. Record byte limits exclude the terminating line endings
and are independent of network chunk boundaries. Unterminated final records
are passed to the protocol-specific EOF handler.
SSE data fields remove at most one ASCII space after the colon, retain other
whitespace, and treat a colon-free `data` field as an empty data line.

## References

- [Hono application API](https://hono.dev/docs/api/hono)
- [Hono middleware](https://hono.dev/docs/guides/middleware)
- [Hono Context](https://hono.dev/docs/api/context)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
