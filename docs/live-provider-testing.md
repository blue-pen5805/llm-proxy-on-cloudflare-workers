# Live Provider Chat Completions Testing

The live test script verifies real provider credentials and model access through
a Wrangler development server running on the local machine. It is intentionally
separate from `npm run test`: every configured provider makes billable network
requests.

Each selected provider uses the public `/v1/chat/completions` API with a
provider-qualified model. The script runs the applicable checks sequentially:

1. **`chat-direct`** calls `/v1/chat/completions` without a Gateway prefix and
   verifies direct provider inference, including the proxy's protocol conversion.
2. **`chat-gateway`** calls `/g/<gateway>/v1/chat/completions` and verifies the
   same public API through AI Gateway.

`LLM_PROXY_GATEWAY_NAME` selects the Gateway for `chat-gateway` only. Otherwise,
the script uses the Worker configuration's default Gateway, or `default` when
none is configured. It does not add a Gateway prefix to `chat-direct`.

The local Worker configuration determines which checks can run:

- If `CLOUDFLARE_ACCOUNT_ID` and `AI_GATEWAY_NAME` select a default Gateway,
  native Gateway providers run only `chat-gateway`: the unprefixed route would
  also use Gateway and would not verify direct inference.
- With `ALWAYS_USE_AI_GATEWAY=true`, all selected providers run only
  `chat-gateway`, including Custom Providers. Synchronize those definitions with
  `npm run secrets:deploy` before testing.
- Vertex AI and Workers AI require Gateway for Chat and skip `chat-direct`.
- Providers without native Gateway support, such as Ollama and custom OpenAI
  endpoints, run only `chat-direct` unless strict Gateway routing is enabled.

To exercise direct inference for native Gateway providers, leave
`AI_GATEWAY_NAME` unset and `ALWAYS_USE_AI_GATEWAY` false in the local Worker
configuration. `CLOUDFLARE_ACCOUNT_ID` can remain configured for the explicit
Gateway check. Restart the local Worker after changing its configuration.
Provider pass-through and the `/chat/completions` alias are covered by automated
tests rather than additional live requests.

All routes use `/key/0` by default. Besides making the credential choice
repeatable, explicit key selection disables the proxy's credential fallback
to additional credentials, keeping each check to one upstream attempt. Set
`LLM_PROXY_KEY_SELECTION` to another supported index or range when testing a
different configured slot.

## Configure models

Copy the tracked, credential-free example to the ignored local file:

```bash
cp live-chat-models.example.jsonc live-chat-models.jsonc
```

Replace `null` only for providers to test. Use the model ID expected by that
provider, without the proxy's provider prefix:

```jsonc
{
  "$schema": "schemas/live-chat-models-schema.json",
  "providers": {
    "openai": "gpt-model-id",
    "anthropic": "claude-model-id",
    "groq": null,
  },
}
```

The local model file is ignored because deployment and custom model names can
be operationally sensitive. It must not contain API keys. Replicate is absent from the example because this proxy does not
implement Chat Completions for it.

Custom OpenAI-compatible endpoints use the same model-only selection:

```jsonc
"custom-endpoint": "model-id"
```

An object with a `model` field is also accepted. The optional `directPath` field
is validated when present but does not affect the checks; upstream operation
paths come from the Worker's provider configuration.

## Run the live checks

Put the real provider credentials and `PROXY_API_KEY` in the ignored
`config.develop.jsonc`. The first terminal starts the local Worker and loads that
configuration through the repository's temporary `.dev.vars.develop` flow:

If the file does not exist yet, initialize it before adding real values:

```bash
cp config.example.jsonc config.develop.jsonc
```

```bash
npm run dev
```

Leave the development server running. In a second terminal, run:

```bash
npm run test:live-chat
```

The script reads `config.develop.jsonc` for proxy authentication, Gateway
routing policy, and credential redaction. Provider credentials are used by the
Wrangler development server and are never copied to the model configuration or
command line. If
`DEV` is explicitly `true`, the local request omits proxy authentication in the
same way as the Worker.

The only accepted target is a loopback address. The default is
`http://127.0.0.1:8787`. To use another local port, start Wrangler and the test
with matching values; deployed Worker URLs remain rejected:

```bash
# First terminal
npm run dev -- --port 8790

# Second terminal
export LLM_PROXY_LOCAL_URL="http://127.0.0.1:8790"
npm run test:live-chat
```

To select a non-default AI Gateway, set its name before running:

```bash
export LLM_PROXY_GATEWAY_NAME="production"
```

Pass one or more provider names after `--` for a smaller run. The explicit
`--provider` option remains available when preferred. Use `--config` for another
model file:

```bash
npm run test:live-chat -- openai
npm run test:live-chat -- openai anthropic
npm run test:live-chat -- --provider openai --provider anthropic
npm run test:live-chat -- --config live-chat-models.staging.jsonc
```

`LIVE_CHAT_TIMEOUT_MS` optionally changes the per-request timeout from 30
seconds, up to 120 seconds.

If the local configuration relies entirely on AI Gateway BYOK and has no
provider credential slots, disable the `/key/0` prefix explicitly:

```bash
export LLM_PROXY_KEY_SELECTION="none"
```

In that mode, the local proxy's configured Gateway fallback behavior applies
and may make more than one upstream attempt.

## Cost and result contract

The fixed prompt is short, streaming is disabled, and the completion limit is
100 tokens. The script sends `max_completion_tokens: 100` when the provider
adapter supports it. For providers such as Cohere that accept only the legacy
field, it sends `max_tokens: 100` instead. Requests run sequentially and the
script never retries. With the default explicit key selection, a full run makes
one upstream attempt per applicable check, up to two per provider. Gateway
policy and provider requirements can reduce this to one check.

Any HTTP 2xx response passes. Network errors, timeouts, and non-2xx responses
fail the command. A non-2xx result includes up to 16 KiB of its upstream error
body so provider messages, types, and codes remain visible. Credential-like JSON
fields, Bearer values, common API-key forms, and the configured proxy key are
redacted before output. Successful response bodies are discarded. The process
exits nonzero when at least one check fails.

For example, a provider response remains actionable in the summary:

```text
FAIL openai chat-direct: HTTP 404 Not Found: {"error":{"message":"Model not found","type":"invalid_request_error","code":"model_not_found"}}
```

Hugging Face Chat uses the Router origin. Its native Gateway integration is not
used for this operation: normal mode runs `chat-direct`, and strict mode runs
`chat-gateway` through the synchronized inference Custom Provider.
