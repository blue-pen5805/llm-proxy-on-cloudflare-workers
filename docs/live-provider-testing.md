# Live Provider Chat Completions Testing

The live test script verifies real provider credentials and model access through
a Wrangler development server running on the local machine. It is intentionally
separate from `npm run test`: every configured provider makes billable network
requests.

For each selected provider, the script makes two sequential requests:

1. **Direct** uses the provider pass-through route, for example
   `/openai/chat/completions`.
2. **Compatibility** uses the proxy's OpenAI-compatible
   `/v1/chat/completions` route with a provider-qualified model.

Providers supported by the proxy's AI Gateway Compatibility Endpoint contract
receive a third **AI Gateway** check at `/g/default/chat/completions`. Providers
such as Ollama and Azure OpenAI that do not support that Gateway compatibility
route retain only the first two checks.

When `LLM_PROXY_GATEWAY_NAME` is set, all applicable paths use the corresponding
`/g/<gateway>` prefix and the third check uses that Gateway instead of `default`.
This exercises the AI Gateway provider endpoint for the Direct request and the
proxy's Compatibility Endpoint selection for supported providers.

All routes use `/key/0` by default. Besides making the credential choice
repeatable, explicit key selection disables the proxy's compatibility fallback
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
be operationally sensitive. It must not contain API keys. Hugging Face and
Replicate are absent from the example because this proxy does not implement
Chat Completions for them.

Custom OpenAI-compatible endpoints can specify their direct route explicitly:

```jsonc
"custom-endpoint": {
  "model": "model-id",
  "directPath": "/v1/chat/completions"
}
```

Built-in direct paths are read from the provider adapters, so they should not be
copied into the model file.

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

The script reads only `PROXY_API_KEY` from `config.develop.jsonc` to authenticate
to the local Worker. Provider credentials stay inside the Wrangler development
server and are never copied to the model configuration or command line. If
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

Use `--provider` one or more times for a smaller run, or `--config` for another
model file:

```bash
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
two upstream attempts for providers without Gateway compatibility and three for
supported providers.

Any HTTP 2xx response passes. Network errors, timeouts, and non-2xx responses
fail the command. A non-2xx result includes up to 16 KiB of its upstream error
body so provider messages, types, and codes remain visible. Credential-like JSON
fields, Bearer values, common API-key forms, and the configured proxy key are
redacted before output. Successful response bodies are discarded. The process
exits nonzero when at least one check fails.

For example, a provider response remains actionable in the summary:

```text
FAIL openai direct: HTTP 404 Not Found: {"error":{"message":"Model not found","type":"invalid_request_error","code":"model_not_found"}}
```
