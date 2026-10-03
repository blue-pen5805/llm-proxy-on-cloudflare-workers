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
The matching zero-based slot is retained in request scope and logged as
`proxy_key_index`; credential values and fingerprints are never logged. A
rejected request receives `WWW-Authenticate: Bearer`, advertising the scheme
without a realm that would name the deployment.

The entry application uses a constant Hono matching path so encoded URL
characters cannot skip authentication, CORS, error handling, or request logs.
The original URL remains available for authenticated path preparation and
upstream forwarding.

Authentication precedes `/key/<selection>` parsing. Were the order reversed, a
malformed selection would answer an unauthenticated client with HTTP 400 while
every other path answered HTTP 401, confirming that the prefix exists.

Authentication is bypassed only when `DEV` is explicitly `true` **and** the
Worker is running locally, determined by the absence of the edge-supplied
`cf-ray` header. Deployed Workers ignore `DEV`, enforce authentication, and log
`auth.development_mode_ignored`. If `PROXY_API_KEY` is absent, empty, or invalid
in other modes, the Worker fails closed with HTTP 503.

CORS preflight is answered before authentication. Actual cross-origin responses,
including authentication and routing errors, receive the matching CORS origin
header without changing the authentication requirement. Such responses carry
`Vary: Origin`; the error guard also adds the applicable CORS headers to errors
raised during CORS handling. Hono response replacement merges existing headers,
so the CORS middleware makes response headers writable through `c.header` and
applies the proxy policy in place. It does not reintroduce upstream permissions
by assigning a replacement response. Preflight permits the bounded provider pass-through
method set (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE`), and actual
responses expose the model cache and truncation diagnostic headers.
`ALLOWED_ORIGINS` optionally restricts browser access to exact origins. Its
absence preserves the wildcard default. Origins are matched as complete HTTP(S)
origins rather than suffixes or patterns. Proxy authentication remains the
security boundary; the allowlist reduces browser use of a disclosed credential
without turning CORS into authorization. Upstream allow-origin and expose-header
values are replaced by the proxy's policy; a denied origin receives neither,
even if the upstream response grants wildcard access.

## Credential isolation

Before chat or pass-through forwarding, the proxy removes every header format it
accepts for its own authentication, provider credential aliases such as
`api-key`, hop-by-hop headers, cookies, and client network metadata. On AI
Gateway routes it retains request-level `cf-aig-*` controls except
`cf-aig-authorization`, `cf-aig-byok-alias`, and `cf-aig-cache-key`; direct
provider requests remove all of them. Callers may legitimately set Gateway
metadata and cost, logging, caching, retry, or backoff controls. Gateway
authentication and stored BYOK selection remain operator-controlled, while the
cache key is also reserved to prevent cross-caller cache reads or poisoning.
For valid object-valued `cf-aig-metadata`, the proxy adds bounded routing
metadata only to unused keys; client values win on collisions, and invalid
metadata passes through unchanged. The provider adapter then adds the selected
upstream key. Credential-like query parameters in the incoming request URL are
removed during middleware processing using the same case-insensitive name set
used for log redaction;
this includes API-key variants, `token`, `access_token`, `authorization`,
`auth`, `password`, and `secret`. Other query parameters retain their encoding,
order, repetition, and empty fields. Path traversal is rejected before
forwarding, including when the path carries a query string. `True-Client-IP` is
included in the client network metadata that is removed.

Connection-specific fields include `Proxy-Connection` and every header named by
a case-insensitive `Connection` option, as required by [RFC 9110, section
7.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1). Those fields
are removed before retaining Gateway tuning controls or injecting operator
credentials. Universal Endpoint step paths share pass-through's percent-encoded
dot-segment validation, including when a path carries a query. Queries inside
JSON `step.endpoint` fields are provider payload, so they are preserved
independently of incoming URL sanitization. They cannot authenticate the proxy,
and the Worker never copies configured credentials into them. See the [Universal
Endpoint contract](../../../user/api/ai-gateway.md#universal-endpoint).

Every outbound provider, AI Gateway, model-list, and connectivity-check request
uses manual redirect handling. The Worker never follows an upstream redirect,
so an authorization header, API-key header, Gateway token, or credential
embedded in a Universal Endpoint body cannot be replayed to the redirect
destination. A redirect response is returned to the caller or handled as the
origin response by the route that initiated it. Callers must not replay the
proxy credential when following a pass-through redirect.

AI Gateway tokens are added as `cf-aig-authorization`. Provider credentials are
sent in provider-specific authentication headers of inference requests,
or embedded into Universal Endpoint steps, because Gateway needs them to call
providers.

## Configuration lifecycle

Local JSONC files are operator inputs; the Worker receives their non-empty
top-level values as environment bindings. Arrays and objects are serialized as
JSON. Other values remain exact text so credential-like strings are never
coerced. Deployment update semantics and serialized-size limits are defined in
[configuration files](../../../user/configuration.md#configuration-files).

The editor and deployment helper use a JSONC parser. The editor validates
against the tracked schema and preserves comments when editing. Deployment
validates effective updates using runtime readers and serialized secret bounds.
Credential input and stored
values are masked, output is value-free, and generated local files use
owner-only permissions. Operator configuration files remain untracked.

Deployment also applies constraints the schema cannot express, including unique
endpoint names, exact origins, and bounded acyclic virtual-model graphs.
Setting `CUSTOM_OPENAI_ENDPOINTS` or `VIRTUAL_MODELS`, or deleting custom
endpoints, resolves an omitted partner to `null`. The same resolved snapshot is
used for validation, Gateway synchronization, and secret deployment: merely
validating the missing value as absent would leave unknown deployed state behind.
Explicitly empty partners remain no-ops and cannot complete a dependent update.
Deleting `VIRTUAL_MODELS` alone preserves custom endpoints because no reference
remains; files that update neither setting preserve both. Other omitted settings
retain their partial-update semantics, and the local JSONC file is not rewritten.
Runtime validation repeats critical checks for bindings installed outside the
repository tooling and fails closed with a non-disclosing HTTP 503.

Effective proxy-key updates must produce a nonempty key pool within the runtime
64-key bound. Unchanged settings and explicit deletions retain their partial
update semantics. All local validation completes before Custom Provider
synchronization or cf operations, using one parsed configuration snapshot
throughout the deployment.

## Error and diagnostic disclosure

Buffered HTTP body readers accept only decimal digits in `Content-Length`,
within the safe-integer range, as required by
[RFC 9110, section 8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6).
Malformed lengths are rejected before body parsing and release the unread body.
Declared lengths do not replace the enforced byte limit on the actual stream.

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
Proxy-generated diagnostic responses explicitly disable client and shared
HTTP caching.

## Non-goals

- Per-user authorization, quotas, and tenant isolation
- Request-body redaction or data-loss prevention
- DNS-level allowlisting of custom endpoint origins
- A Web Application Firewall or provider-specific content policy

Operators that need these controls should add appropriate Cloudflare and
application-layer policies around the Worker.

## References

- [Workers configuration](https://developers.cloudflare.com/workers/configuration/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/#environment-variables)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Request API](https://developers.cloudflare.com/workers/runtime-apis/request/)

## Deployment tooling

`cf` handles authentication, code deployment, and Worker secret operations.
`cloudflare.config.ts` owns the deployment configuration and rejects undeclared
named modes. Vitest derives its entry point and runtime compatibility settings
from that configuration and supplies them through the test plugin's `main` and
`miniflare` options. Hono CLI inspects route declarations; `cf dev` serves local
HTTP checks. Wrangler remains the internal bundler, using its default settings
without a separate configuration file. See the official
[Workers test configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/#cloudflaretestoptions).

The configuration editor reads `cf auth whoami` JSON (`authenticated` and
`accounts`). Secret deployment maps the helper's `--env` to `cf --mode`,
evaluates `cloudflare.config.ts` with that mode, and passes its `worker.name`
explicitly as `--worker` to both secret list and bulk API commands. Undeclared
modes are rejected before Gateway synchronization or invoking those commands. Deployment
uses `cf workers secrets bulk --file` with a JSON Merge Patch body containing
`secrets`: each set operation is `{ name, type: "secret_text", text }`, each
delete is `null`, and omitted names remain unchanged. The owner-only temporary
file is removed on completion and interruption. Both CLI output streams are
suppressed because API responses or errors may include secret material; only
the child process outcome is reported. Code must be deployed before secrets
are uploaded.

The `KeyRotationManager` export has a deletion tombstone so installations
that still have its namespace can apply the deletion. No live Durable Object
namespace is declared. See the official [cf configuration mapping](https://developers.cloudflare.com/cf/wrangler/reference/)
and [bulk secret API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/bulk_update/).
