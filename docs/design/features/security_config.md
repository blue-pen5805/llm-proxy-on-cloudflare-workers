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

Authentication is bypassed only if `DEV` is explicitly `true`. If
`PROXY_API_KEY` is absent, empty, or invalid in other modes, the Worker fails
closed with HTTP 503.

CORS preflight is answered before authentication. Actual cross-origin responses,
including authentication and routing errors, receive the matching CORS origin
header without changing the authentication requirement.

## Credential isolation

Before chat or pass-through forwarding, the proxy removes every header format it
accepts for its own authentication, provider credential aliases such as
`api-key`, hop-by-hop headers, cookies, and client network metadata. On AI
Gateway routes it retains request-level `cf-aig-*` controls except
`cf-aig-authorization`; direct provider requests remove all of them. A client can
therefore override non-credential Gateway request controls, while Gateway
authentication always comes from operator configuration. The provider adapter
then adds the selected upstream key. Credential-like query parameters are
removed during middleware processing; other query parameters are retained.

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
identifiers, and feature flags. It must remain behind proxy authentication and
should not be treated as public health metadata.

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
