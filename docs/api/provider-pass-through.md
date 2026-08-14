# Provider pass-through API

A pass-through request removes the registered provider prefix and forwards the
remaining method, body, query string, and non-proxy headers in the provider's
native format:

```bash
curl https://your-worker.example/openai/v1/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"model":"gpt-4o-mini","input":"Hello"}'
```

Routes are the keys registered in `src/providers.ts`; configured custom
endpoint names are added dynamically. Append `:<profile>` to a provider name to
select a named credential pool. Provider-specific request and response formats
remain the caller's responsibility.

The proxy replaces client authentication headers with the selected upstream
credential. It also removes cookies, hop-by-hop headers, client and network
metadata, and credential-like query parameters, including API-key variants,
`access_token`, `token`, `authorization`, `auth`, `password`, and `secret`.
`True-Client-IP` is never forwarded. Retained query parameters are passed
through byte-for-byte, including empty fields. Path `.` and `..` segments are
rejected; matching text inside a query value is preserved.

All outbound requests use manual redirect handling, so the Worker never follows
a redirect with credentials attached. Pass-through routes return upstream 3xx
responses unchanged; clients must not replay the proxy credential when
following them.

Request-level `cf-aig-*` control headers are forwarded when the selected route
uses AI Gateway and removed on direct provider requests. Client
`cf-aig-authorization`, `cf-aig-byok-alias`, and `cf-aig-cache-key` are always
removed; Gateway authentication, stored-credential selection, and cache
partitioning remain operator-controlled.

In strict Gateway mode, pass-through paths for a managed Custom Provider retain
the configured upstream path semantics. Direct pass-through keeps the
configured Base URL unchanged. See
[Custom Provider path behavior](../design/features/ai_gateway.md#custom-provider-path-behavior).

For cloud-platform pass-through, direct routes use the upstream provider path.
Bedrock paths beginning with `/v1` are automatically prefixed with
`bedrock-runtime/<region>` when routed through AI Gateway. Azure's classic
`/openai/deployments/<deployment>/...` path is similarly converted to
Gateway's `<resource>/<deployment>/...` form. Vertex pass-through is available
only with AI Gateway, and its provider-native path already matches the Gateway
suffix.
