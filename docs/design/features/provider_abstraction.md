# Provider Abstraction and Compatibility

## Responsibilities

The `Provider` interface defines upstream URL construction, key access, request
headers, chat request filtering, model request construction, and model response
normalization. `createProvider` composes the shared behavior with a small
`ProviderDefinition` containing only provider-specific values and hooks.
`defineProvider` preserves the existing `new ProviderName()` constructor
interface without coupling adapters through a base-class hierarchy.

`ProviderBase` and `OpenAICompatibleProvider` remain constructable compatibility
exports. New adapters should use definitions directly; OpenAI-compatible
definitions opt into the shared JSON and Bearer-authentication behavior with
`openAICompatible: true`.

This is an adapter boundary rather than a promise of complete semantic parity.
Provider adapters can filter chat fields, translate payloads, or declare model
listing unsupported.

## Provider registry

`src/providers.ts` is the authoritative built-in provider table.
`ProviderRegistry` combines that table with the custom endpoint snapshot for a
single request. It owns provider discovery, route-prefix matching, lazy
construction, and instance reuse. Request handlers therefore consume one
consistent provider view without rebuilding every adapter during route
selection.

The top-level `getProviderByName` and `getAllProviderInstances` functions are
convenience facades over the registry. Built-in provider lookup and aggregate
listing keep their existing precedence when a custom endpoint reuses a built-in
name.

Universal Endpoint steps must pass both Cloudflare's supported-provider check
and lookup in the request-scoped registry. A provider advertised by Gateway but
without a local adapter is therefore a client error rather than an undefined
constructor failure.

Availability is normally determined by whether a provider's configured key
list is non-empty. Workers AI has additional account configuration, while
custom endpoints are available by definition. Availability controls model
aggregation and status metadata; routing still resolves a registered provider
class even when it has no key.

AI Gateway-managed authentication is a deliberate exception: chat and model
requests may be sent
without a locally configured provider key when a Gateway context exists. The
Gateway then injects its stored credential. Adapters can rewrite provider-native
Gateway paths, opt model listing out of Gateway, or build a native Gateway chat
request when the Compatibility Endpoint does not support the provider shape.
Gateway-specific credential representations remain index-aligned with the
provider's ordinary credential list so explicit and coordinated selection refer
to the same slot.
Providers may also declare Gateway as mandatory; direct chat and pass-through
then fail before any upstream request is attempted. Vertex AI uses this mode;
its service-account JSON is converted to the Gateway credential header instead
of being treated as a short-lived OAuth access token.

Commented imports or provider directories that are not registered are not
supported routes. Documentation should distinguish three independent
capabilities:

- OpenAI-compatible chat translation;
- model-list translation;
- provider-specific pass-through.

Pass-through usually needs only a base URL and authentication. The other two
require adapter methods and tests for the provider's actual formats.

## OpenAI-compatible chat flow

1. Parse and validate the JSON body.
2. Resolve `default` or split `<provider>/<model>` at the first slash.
3. Resolve an API key index.
4. Let the adapter filter or translate supported fields and remove the provider
   prefix from the model.
5. Send directly or construct an AI Gateway request.
6. Forward the upstream response.

The incoming abort signal is attached to the provider or Gateway subrequest so
client cancellation can stop avoidable work. The Worker enables the
`enable_request_signal` compatibility flag.

## Model aggregation flow

Every registered and custom provider is considered concurrently. Unavailable
providers return no models. Static lists avoid network access; other providers
receive a model-list request with a five-second timeout. Fulfilled results are
converted to OpenAI model objects and prefixed with their route name. Rejected or
malformed responses are logged and omitted.

## Extension requirements

A new provider requires a definition, registration, configuration/schema
support, contract tests, and documentation. Tests should cover URL and header construction,
availability, supported chat fields, model conversion, direct routing, and AI
Gateway behavior independently. See [Development and verification](../../development.md).

## References

- [OpenAI API reference](https://platform.openai.com/docs/api-reference)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare AI Gateway providers](https://developers.cloudflare.com/ai-gateway/providers/)
