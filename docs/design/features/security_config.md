# Security and Configuration

## Trust model

The deployment operator controls Worker configuration and upstream provider
definitions. Clients are untrusted and must authenticate to the proxy. Upstream
providers and AI Gateway receive only credentials needed for the selected route.

## Client authentication

`PROXY_API_KEY` accepts up to 64 shared secrets. A client may provide a Bearer
token, `x-api-key`, or `x-goog-api-key`. Query-string authentication is rejected
so proxy credentials do not enter URL logs. Candidate and configured values are
SHA-256 hashed and compared at fixed length without an early return across
configured keys.

Authentication is bypassed only when `DEV` is explicitly `true` **and** the
Worker is running locally, determined by the absence of the edge-supplied
`cf-ray` header. Deployed Workers ignore `DEV`, enforce authentication, and log
`auth.development_mode_ignored`. If `PROXY_API_KEY` is absent, empty, or invalid
in other modes, the Worker fails closed with HTTP 503.

CORS preflight is answered before authentication. Actual cross-origin responses,
including authentication and routing errors, receive the matching CORS origin
header without changing the authentication requirement. Such responses carry
`Vary: Origin`; the error guard also adds the applicable CORS headers to errors
raised during CORS handling.

## Credential isolation

Before chat or pass-through forwarding, the proxy removes every header format it
accepts for its own authentication, provider credential aliases such as
`api-key`, hop-by-hop headers, cookies, and client network metadata. On AI
Gateway routes it retains request-level `cf-aig-*` controls except
`cf-aig-authorization` and `cf-aig-byok-alias`; direct provider requests remove
all of them. A client can therefore override non-credential Gateway request
controls, while Gateway authentication and stored BYOK credential selection
remain operator-controlled. The provider adapter then adds the selected
upstream key. Credential-like query parameters are removed during middleware
processing using the same case-insensitive name set used for log redaction;
this includes API-key variants, `token`, `access_token`, `authorization`,
`auth`, `password`, and `secret`. Other query parameters retain their encoding,
order, repetition, and empty fields. Path traversal is rejected before
forwarding, including when the path carries a query string. `True-Client-IP` is
included in the client network metadata that is removed.

Every outbound provider, AI Gateway, model-list, and connectivity-check request
uses manual redirect handling. The Worker never follows an upstream redirect,
so an authorization header, API-key header, Gateway token, or credential
embedded in a Universal Endpoint body cannot be replayed to the redirect
destination. A redirect response is returned to the caller or handled as the
origin response by the route that initiated it. Callers must not replay the
proxy credential when following a pass-through redirect.

AI Gateway tokens are added as `cf-aig-authorization`. Provider credentials are
sent in the upstream authorization headers of Compatibility Endpoint requests,
or embedded into Universal Endpoint steps, because Gateway needs them to call
providers.

## Configuration lifecycle

Local JSONC files are operator inputs, not runtime files. `deploy-secrets.ts`
serializes each non-empty top-level value and supplies it to `wrangler secret
bulk`; a top-level `null` is preserved as Wrangler's explicit deletion
operation. Arrays and custom endpoint objects therefore arrive as JSON strings
and are parsed by the environment utilities. Before invoking Wrangler, every
non-null serialized value is checked against Cloudflare's 5 KiB secret limit.
Local `.dev.vars` generation omits `null` and missing top-level values rather
than materializing empty bindings. Runtime secret lookup also ignores empty and
whitespace-only string entries, so they cannot make a provider appear
configured.

The schema validates shape during editing and critical custom-endpoint
constraints are checked again at runtime. Configuration files contain live
credentials and must not be committed. Deployment and dry-run output list names
only and redact values.

## Error and diagnostic disclosure

Known application errors return stable public messages. Unexpected exceptions
are logged and returned as a generic HTTP 500 error. Subrequest logging records
only the upstream URL scheme, host, and path; query strings and fragments are
omitted entirely.

`/status` never returns key values or suffixes, but intentionally reveals
provider availability, credential slot numbers, the default model, AI Gateway
identifiers, and feature flags. `/virtual-models` reveals configured virtual
model names, candidate model names, failover order, retries, and timeouts, but
no credential material. Both routes remain behind proxy authentication and
their output should not be treated as public metadata.

## Non-goals

- Per-user authorization, quotas, and tenant isolation
- Request-body redaction or data-loss prevention
- DNS-level allowlisting of custom endpoint origins
- A Web Application Firewall or provider-specific content policy

Operators that need these controls should add appropriate Cloudflare and
application-layer policies around the Worker.

## References

- [Workers configuration](https://developers.cloudflare.com/workers/configuration/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Request API](https://developers.cloudflare.com/workers/runtime-apis/request/)
