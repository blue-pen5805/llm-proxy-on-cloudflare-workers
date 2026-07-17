# Custom OpenAI-Compatible Endpoints

## Motivation

Deployment configuration can register OpenAI-compatible upstreams without a new
provider class. This covers self-hosted inference and vendor endpoints whose
authentication and response formats already follow the OpenAI contract.

## Configuration model

Each `CUSTOM_OPENAI_ENDPOINTS` entry requires a unique `name` and `baseUrl` and
may define `apiKeys`, a static `models` array, `chatCompletionPath`, and
`modelsPath`. The default paths are `/chat/completions` and `/models`.

Configuration is trusted operator input. The implementation does not currently
reject duplicate names, built-in name collisions, non-HTTPS origins, or malformed
path combinations. Documentation and deployment review therefore carry those
validation responsibilities.

## Resolution and routing

`getProviderByName` resolves built-in providers before custom endpoints, so a
custom name cannot override a built-in route. `getAllProviderInstances` then
adds custom entries to the provider map; a colliding custom name can replace the
built-in instance in aggregate operations. Names must therefore be unique across
both sets.

Once resolved, the endpoint supports:

- pass-through at `/<name>/<path>`;
- chat translation using `<name>/<model>`;
- model aggregation through a static list or the configured models path;
- status checks for each configured key.

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
