# Security and Configuration

## Trust model

The deployment operator controls Worker configuration and upstream provider
definitions. Clients are untrusted and must authenticate to the proxy. Upstream
providers and AI Gateway receive only credentials needed for the selected route.

## Client authentication

`PROXY_API_KEY` accepts one or more shared secrets. A client may provide a Bearer
token, `x-api-key`, `x-goog-api-key`, or the `key` query parameter. Candidate and
configured values are SHA-256 hashed and compared at fixed length without an
early return across configured keys.

Authentication is bypassed if `PROXY_API_KEY` is absent or `DEV` evaluates to
true. These modes exist for development and make a public Worker unsafe.

CORS preflight is answered before authentication. This permits browser clients
to negotiate CORS but does not grant access to protected request methods.

## Credential isolation

Before chat or pass-through forwarding, the proxy removes every header format it
accepts for its own authentication. The provider adapter then adds the selected
upstream key. The `key` query parameter is removed during middleware processing;
other query parameters are retained.

AI Gateway tokens are added as `cf-aig-authorization`. Provider credentials may
also be embedded into Universal Endpoint steps because Gateway needs them to
call providers.

## Configuration lifecycle

Local JSONC files are operator inputs, not runtime files. `deploy-secrets.ts`
serializes each non-empty top-level value and supplies it to `wrangler secret
bulk`. Arrays and custom endpoint objects therefore arrive as JSON strings and
are parsed by the environment utilities.

The schema validates shape during editing but does not replace runtime checks.
Configuration files and dry-run output can contain live credentials and must not
be committed or exposed in CI logs.

## Error and diagnostic disclosure

Known application errors return stable public messages. Unexpected exceptions
are logged and returned as a generic HTTP 500 error. Subrequest logging masks a
defined list of sensitive query parameter names.

`/status` masks keys but intentionally reveals provider availability, key
suffixes, the default model, AI Gateway identifiers, and feature flags. It must
remain behind proxy authentication and should not be treated as public health
metadata.

## Non-goals

- Per-user authorization, quotas, and tenant isolation
- Request-body redaction or data-loss prevention
- Validation of arbitrary custom endpoint origins
- A Web Application Firewall or provider-specific content policy

Operators that need these controls should add appropriate Cloudflare and
application-layer policies around the Worker.

## References

- [Workers configuration](https://developers.cloudflare.com/workers/configuration/)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
