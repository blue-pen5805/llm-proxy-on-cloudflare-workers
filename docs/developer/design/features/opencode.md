# OpenCode Providers and Live Protocol Selection

## Provider boundary

`opencode-zen` uses `https://opencode.ai/zen/v1`; `opencode-go` uses
`https://opencode.ai/zen/go/v1`. Both read `OPENCODE_API_KEY` through the shared
secret reader. Scalar, array, and named-profile credentials apply to both
providers; the same profile shares its key pool and rotation state. Model IDs
remain provider-qualified, for example `opencode-zen/<model-id>` or
`opencode-go:paid/<model-id>`.

Discovery and status use each provider's `/models` operation. The OpenAI-format
lists are consumed independently and receive the corresponding proxy provider
prefix. The proxy does not derive model availability from the protocol catalog.

## Cached protocol catalog

Public Chat Completions, Responses, and Messages resolve a concrete model before
converting its payload or selecting an inference transport. The asynchronous
provider resolver reads `https://models.opencode.ai/api.json` through a shared
five-minute Cache API cache, including virtual-model candidates. Zen reads
the `opencode` entry; Go reads `opencode-go`. A model's `provider.npm` overrides the entry's
top-level `npm`; an absent model override inherits the top-level value.

The catalog is fetched without proxy credentials, provider credentials, Gateway
headers, or request content. Origin fetches use `no-store` and manual redirects;
application caching is managed explicitly in the `llm-proxy-opencode-protocol-v1`
Cache API namespace. Successful model resolution stores only the public Zen and
Go entries under the fixed catalog URL with a 300-second TTL. The cache is
shared across providers and credential profiles and is independent of the
aggregate model-list cache. No credentials or inference content enter it.

Cache misses and expired entries fetch the origin. An invalid cached entry or
one that cannot resolve the requested model also triggers a fresh lookup.
Invalid origin responses and failed model resolution are not stored. Cache
read/write failures emit a content-free warning and allow origin-based
resolution to continue. There is no stale fallback after an origin failure.
Selected operations remain request-scoped; refreshed SDK declarations affect
subsequent resolution.

The cache is best-effort, local to a Cloudflare datacenter, and subject to
platform availability. Cloudflare documents functional storage on custom domains
and unavailable storage in dashboard previews and behind Cloudflare Access.
Concurrent misses may each fetch the origin; no request-owned Promise or stream
is shared between requests.

Only the selected SDK identifier controls protocol selection. Catalog `api`
origins and other model metadata never become outbound destinations. The
provider origins and the SDK-to-path mapping are fixed in code:

| Resolved SDK                | Public native capability                   | Path relative to the provider base URL    |
| --------------------------- | ------------------------------------------ | ----------------------------------------- |
| `@ai-sdk/openai-compatible` | Chat Completions                           | `/chat/completions`                       |
| `@ai-sdk/openai`            | Responses                                  | `/responses`                              |
| `@ai-sdk/anthropic`         | Messages                                   | `/messages`                               |
| `@ai-sdk/google`            | None; Chat conversion uses GenerateContent | `/models/<encoded-model>:generateContent` |

Streaming Google requests use `:streamGenerateContent?alt=sse`. SDK identifiers
are metadata, not dynamically imported packages. Model lookup requires an own
property; inherited names cannot select a model. Missing models return HTTP 400. Fetch failures, redirects, invalid JSON or catalog structure, and unknown
SDKs return a non-disclosing HTTP 502 without an inference request. Catalog
resolution, including cache operations, fetch, and body reading, has a
five-second deadline and an 8 MiB body limit. A configured virtual-model
candidate timeout also bounds catalog resolution, separately from its inference response-header wait. Client
cancellation propagates to the catalog request. There is no
guessed endpoint or protocol retry after a catalog or inference error.

## Native and converted inference

A matching public API uses its native operation and preserves JSON/SSE,
including provider-specific fields. Otherwise the public request converts
through Chat and the selected SDK's codec. Messages and GenerateContent reuse
the [native conversion contract](native_inference.md#conversion-contract).
Messages conversion requires a token limit. Only the catalog-declared API is
treated as native.

The Chat-to-Responses codec maps ordered system, developer, user, assistant, and
function-tool history into input items. It supports text, HTTP(S) or base64
images, refusals, function tools and tool choice, parallel-tool control, token
limits, sampling, reasoning effort, text verbosity, JSON output formats,
metadata, storage, user and safety identifiers, service tier, and prompt-cache
key/retention fields. `max_completion_tokens` takes precedence over
`max_tokens`. Storage and function-tool strictness default to `false` to retain
Chat semantics. Only `n: 1` is supported. Unsupported top-level fields, legacy
function messages, and unsupported content types return HTTP 400.

Responses output maps text, refusal, function calls, finish reasons, and token
usage to Chat. Function argument strings retain their encoding. Reasoning text
is omitted; reasoning-token and cached-token details are retained. JSON reads
are bounded to 5 MiB. Invalid successful responses return HTTP 502; upstream
HTTP errors pass through. SSE conversion retains tool indexes rather than
generated text or arguments, limits records to 1 MiB and tools to 64, requires a
terminal completion/incomplete event, and propagates cancellation. Usage is
emitted only when Chat `stream_options.include_usage` is true.

## Authentication and Gateway routing

Chat, Responses, and model listing use Bearer authentication. Messages uses
`x-api-key` and defaults `anthropic-version` to `2023-06-01` when absent.
GenerateContent uses `x-goog-api-key`; provider keys are not placed in URLs.
Caller-supplied `x-opencode-session` and user-agent headers follow the ordinary
header-preservation contract.

Inference, discovery, and pass-through connect directly in non-strict mode.
Strict Gateway mode uses separate synchronized Custom Providers named
`LLM Proxy / opencode-zen` and `LLM Proxy / opencode-go`, with the provider base
URLs above. Registration includes distinct provisional SVG logos from
`src/providers/opencode/zen-logo.svg` and `go-logo.svg`. These are proxy-supplied
icons, not official OpenCode artwork. Catalog lookup remains a credential-free
metadata request to its fixed public origin in either mode.

Provider pass-through appends the requested path to the provider base URL,
applies path-specific authentication, and preserves the caller's native wire
format. It does not consult the catalog or rewrite an explicit endpoint.

## References

- [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)
- [OpenCode Zen endpoints](https://opencode.ai/docs/zen/#endpoints)
- [OpenCode Go endpoints](https://opencode.ai/docs/go/#endpoints)
- [OpenCode protocol catalog](https://models.opencode.ai/api.json)
- [Zen model list](https://opencode.ai/zen/v1/models)
- [Go model list](https://opencode.ai/zen/go/v1/models)
- [Responses request and response schema](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
