# AI Gateway API

The proxy exposes the Cloudflare AI Gateway Universal Endpoint, selected
account-level REST API routes, and a legacy compatibility pass-through route.
Use `/g/<gateway>` to select a Gateway explicitly. Where supported, omitting the
prefix uses `AI_GATEWAY_NAME`.

## Universal Endpoint

`POST /g/<gateway>/` forwards an AI Gateway Universal Endpoint request. When a
Gateway context already exists, `POST /` is the same route without an explicit
prefix and uses `AI_GATEWAY_NAME` or `default`. The
body must be a non-empty JSON array with at most 16 steps. Each step needs a
supported `provider` and an object-valued `query`.

Client-provided authentication headers cannot override configured provider
credentials. A custom step `endpoint` is normalized to a relative path, limited
to 2,048 characters, and cannot contain a URL scheme, backslash, control
character, or `.` or `..` path segment.

## REST API

The proxy exposes Cloudflare's account-level AI Gateway REST API through exactly
four fixed routes:

- `POST /g/<gateway>/ai/run`
- `POST /g/<gateway>/ai/v1/chat/completions`
- `POST /g/<gateway>/ai/v1/responses`
- `POST /g/<gateway>/ai/v1/messages`

Configure both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The Worker
forwards request and response streams without translating their bodies,
replaces the client authentication header with the Cloudflare API token, and
sets `cf-aig-gateway-id` to the selected Gateway. The unprefixed `/ai/...`
forms are shortcuts for the configured `AI_GATEWAY_NAME`, or `default` when
that name is absent. An explicit `/g/<gateway>/ai/...` prefix overrides either
choice.

```bash
curl https://your-worker.example/g/production/ai/v1/responses \
  --header "Authorization: Bearer $PROXY_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"model":"openai/gpt-5.6-sol","input":"Hello"}'
```

Other methods and paths under `/ai` are rejected rather than forwarded.
Third-party models use `<provider>/<model>`; Workers AI models use
`@cf/<author>/<model>`. The Messages route does not support Workers AI.

Client `cf-aig-*` control headers are forwarded, allowing retry, cache, cost,
log, and metadata settings to override Gateway defaults for that request.
Client `cf-aig-authorization`, `cf-aig-byok-alias`, and `cf-aig-cache-key` are
always removed. A configured `CF_AIG_TOKEN`, REST API authorization, and the
route-selected Gateway ID are applied by the Worker after client header
processing and therefore take precedence where applicable.

## Compatibility pass-through

`POST /g/<gateway>/compat/chat/completions` passes an OpenAI-compatible Chat
Completions request to AI Gateway without using the proxy's provider adapters.
The unprefixed `POST /compat/chat/completions` form is the same route when a
Gateway context exists.

## Request metadata

Resolved Chat Completions, Responses, Messages, provider pass-through, and
Universal Endpoint requests routed through AI Gateway add proxy-owned fields to
`cf-aig-metadata` when space remains, in the following priority order:

- `llm_proxy_virtual_model`: outer client-requested virtual model, when used;
- `llm_proxy_endpoint`: public proxy operation, such as `chat_completions`,
  `responses`, `messages`, `provider_proxy`, or `universal_endpoint`;
- `llm_proxy_provider`: resolved provider;
- `llm_proxy_model`: resolved concrete model;
- `llm_proxy_credentials`: selected credential as
  `<credential-profile>:<provider-key-index>`, for example `default:0` or
  `paid:1`. The index is `null` when Gateway BYOK supplies the key, such as
  `default:null`.

Universal Endpoint requests omit `llm_proxy_credentials` because separate
steps can use different credentials. Client metadata wins on key collisions;
the proxy preserves invalid client JSON unchanged and never adds credential
values or proxy-authentication key slots. Cloudflare stores at most five
metadata entries, so client entries can leave insufficient room for later proxy
fields.
