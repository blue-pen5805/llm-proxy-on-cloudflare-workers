# Provider pass-through API

A pass-through request removes the registered provider prefix and forwards the
remaining method, body, query string, and non-proxy headers in the provider's
native format:

```bash
curl https://your-worker.example/openai/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"model":"gpt-4o-mini","input":"Hello"}'
```

Use a [configured provider route](../configuration.md#provider-credentials) or
a custom endpoint name. Append `:<profile>` to a provider name to
select a named credential pool. Provider-specific request and response formats
remain the caller's responsibility.

The remaining path is appended to the provider's configured Base URL. OpenAI's
Base URL already includes `/v1`, so `/openai/responses` targets
`https://api.openai.com/v1/responses`.
The caller's `Content-Type`, including multipart boundaries, is preserved on
direct and Gateway routes. An absent media type remains absent. This supports
native multipart and binary uploads without changing their body bytes.

Pass-through accepts `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE`.
Other methods, including `TRACE` and `CONNECT`, return HTTP 405 with the allowed
method set in the `Allow` response header and are never forwarded upstream.

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
[Custom Provider path behavior](../../developer/design/features/ai_gateway.md#custom-provider-path-behavior).

For cloud-platform pass-through, direct routes use the upstream provider path.
Bedrock paths beginning with `/v1` are automatically prefixed with
`bedrock-runtime/<region>` when routed through AI Gateway. Azure's classic
`/openai/deployments/<deployment>/...` path is similarly converted to
Gateway's `<resource>/<deployment>/...` form. Vertex pass-through is available
only with AI Gateway, and its provider-native path already matches the Gateway
suffix.

OpenCode base URLs include `/zen/v1` and `/zen/go/v1`; for example,
`/opencode-zen/messages` reaches `https://opencode.ai/zen/v1/messages`. Explicit
pass-through paths do not trigger model-catalog lookup or conversion. Use the
public inference routes with provider-qualified model IDs for [automatic
protocol selection](../../developer/design/features/opencode.md).
