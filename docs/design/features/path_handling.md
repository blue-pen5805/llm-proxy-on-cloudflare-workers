# Path Handling and Request Normalization

## Representation

The internal field is named `pathname`, but `getPathname` stores the URL suffix
after the origin, including the query string. This is necessary because the
proxy preserves non-authentication query parameters for pass-through requests.

## Rewriting order

1. `requestMiddleware` extracts the origin-relative URL.
2. `apiKeyPathMiddleware` parses an optional leading key selection and removes
   that prefix.
3. `authMiddleware` removes the `key` authentication query parameter while
   preserving other parameters.
4. `aiGatewayMiddleware` removes an optional `/g/<gateway>` prefix.
5. `routerMiddleware` matches exact OpenAI-compatible routes or a registered
   provider prefix available through its provider scan.

For example:

```text
/key/1-3/g/production/openai/v1/models?key=proxy-secret&region=us
    -> key selection: {start: 1, end: 3}
    -> Gateway: production
    -> provider: openai
    -> upstream path: /v1/models?region=us
```

## Key prefix grammar

The leading forms `/key/N`, `/key/N-M`, `/key/N-`, and `/key/-M` are supported.
Indices are zero-based. Parsing only occurs at the beginning of the path, so an
upstream path containing `/key/...` elsewhere is not changed.

The middleware records the selection; the provider handler resolves it after it
knows the number of configured keys. A single index wraps modulo the key count,
while ranges select randomly from an inclusive bounded interval.

## Router matching

Exact OpenAI-compatible routes include both versioned and unversioned aliases.
Provider pass-through requires `/<provider>/` with a trailing slash after the
provider name. Gateway compatibility routes match `/compat`, `/compat/...`, and
their query variants only when a Gateway context exists. The Universal Endpoint
matches `POST /` only when a Gateway context exists.

This normalization is routing logic, not a general defense against malicious
upstream paths. Provider base URLs remain fixed by code or trusted deployment
configuration.

## Related documents

- [Middleware pipeline](middleware_pipeline.md)
- [Security and configuration](security_config.md)
- [HTTP API and routing](../../api.md)
