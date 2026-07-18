# Custom OpenAI-Compatible Endpoints

## Motivation

Deployment configuration can register OpenAI-compatible upstreams without a new
provider class. This covers self-hosted inference and vendor endpoints whose
authentication and response formats already follow the OpenAI contract.

## Configuration model

Each `CUSTOM_OPENAI_ENDPOINTS` entry requires a unique `name` and `baseUrl` and
may define `apiKeys`, a static `models` array, `chatCompletionPath`, and
`modelsPath`. The default paths are `/chat/completions` and `/models`.

Configuration remains trusted operator input, but schema and runtime validation
reject non-HTTPS origins, malformed paths, duplicate names, and built-in route
collisions. At most 16 endpoints are accepted, with per-endpoint limits of 32
keys and 1,000 static model IDs. Invalid runtime configuration is not treated as
an empty endpoint list: after proxy authentication, requests fail with a safe
HTTP 503 configuration error that does not echo the rejected value.

## Resolution and routing

The validated name index gives routing, aggregation, and status one consistent
provider instance. Invalid duplicate or reserved names prevent registry
creation rather than being silently skipped.

Once resolved, the endpoint supports:

- pass-through at `/<name>/<path>`;
- chat translation using `<name>/<model>`;
- model aggregation through a static list or the configured models path;
- status checks for each configured key.

When `ALWAYS_USE_AI_GATEWAY=true`, every upstream operation uses the endpoint's
managed AI Gateway Custom Provider instead of its direct Base URL. The
deployment helper registers the Base URL under `LLM Proxy / <name>`; the Worker
appends each configured chat, models, or pass-through path at request time.

## Authentication and rotation

Keys are optional. When present, the adapter adds Bearer authentication and uses
the same explicit/random/global selection policy as built-in providers. Its
Durable Object rotation identifier is the endpoint name. An unauthenticated
custom endpoint is considered available, which is necessary for internal or
public upstreams but places responsibility for origin access control on the
operator.

## Model discovery

A non-empty static `models` list is converted to OpenAI model objects locally and
avoids an upstream request. Otherwise, aggregation fetches `modelsPath` with a
five-second timeout. Failure omits that endpoint from the aggregate response
without failing the entire request.

Static model objects use the custom name as `owned_by` and are then prefixed by
the aggregate handler, producing IDs of `<name>/<model>`.

## References

- [OpenAI API reference](https://platform.openai.com/docs/api-reference)
- [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [AI Gateway Custom Providers](https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/)
