# Operations and Troubleshooting

## Deployment checklist

1. Run `npm ci` on a clean checkout.
2. Create or update the target `config[.<env>].jsonc` outside version control
   with `npm run secrets -- [--env <env>]`. For a named environment,
   first declare the matching environment in `wrangler.jsonc`.
3. Preview settings with `npm run secrets:deploy -- --dry-run [--env <env>]`.
   Values, prefixes, and lengths are redacted; each operation is shown as
   `[set]` or `[delete]`. The preview also rejects circular virtual-model
   references and expansions above the bounded attempt limit.
4. Run `npm run tsc`, `npm run lint`, and `npm test`.
5. Deploy code with `npm run deploy` (or `npm run deploy -- --env <env>` for a
   declared Wrangler environment).
6. Deploy settings with `npm run secrets:deploy -- [--env <env>]`.
7. Verify `/ping`, then authenticated `/status`, `/v1/models`, and one real
   request for each critical provider.

The code deployment and secret deployment are separate. A successful Worker
deployment does not prove that the expected secrets exist in the same Wrangler
environment.

## Safe configuration changes

- Keep `config.jsonc`, environment-specific variants, `.dev.vars*`, and
  `.secrets-temp*.json` out of version control.
- Use distinct `PROXY_API_KEY` values per environment.
- Set a setting to `null` and deploy secrets to delete it from the Worker.
  Omitting a setting preserves its current deployed value.
- Keep every serialized setting within the enforced 5,120-byte limit.
  The deployment command validates this before contacting Wrangler.
- Replace a provider key in the configuration, deploy secrets, verify it, and
  only then revoke the old key at the provider.
- When changing an array's order with round-robin enabled, expect each
  isolate's in-memory rotation counter to continue against the new array. It
  is bounded to the new length, but does not track key identity; a redeploy
  restarts rotation from fresh random phases.
- Treat `CF_AIG_TOKEN`, `CLOUDFLARE_API_TOKEN`, and the entire
  `CUSTOM_OPENAI_ENDPOINTS` value as secrets.

## Observability

Workers Logs are enabled for every invocation in `wrangler.jsonc`; traces use
head sampling. Filter structured records by `event` and correlate them with the
complete `request_id`. Use `request.started` for the route and safe routing
metadata, `subrequest.completed` or `subrequest.failed` for upstream outcomes,
and `request.completed` for the final status and handler latency.

Virtual-model requests emit `virtual_model.select` before each candidate
attempt. A retryable result emits `virtual_model.retry` before the next select
event; the final HTTP result or final error emits `virtual_model.completed`.

`request.completed.duration_ms` ends when response headers are returned, so it
does not measure completion of a streamed response body. Logs exclude query
strings, headers, payloads, stack traces, and credential material, but access
and retention must still be restricted. The full event and disclosure contract
is in [Monitoring and diagnostics](design/features/monitoring_diagnostics.md#platform-observability).

Filter on `provider.key.selected` to audit credential-slot usage. `key_index`
is zero based, `provider_request_id` correlates one-to-one requests with their
upstream result, and `selection_policy` explains how the slot was chosen. Slot
numbers follow configuration order and change when keys are reordered.

Use health endpoints deliberately:

- `/ping` checks Worker routing without contacting providers.
- `/status` checks every configured credential against its model-list endpoint,
  concurrently. Large credential sets can exhaust the per-request subrequest
  budget, consume provider quota, and expose limited configuration metadata.
- `/v1/models` is best-effort. Check Worker logs when a provider is absent.

## Common failures

### HTTP 401 from the proxy

- Confirm `DEV` is not being relied on outside local development. A deployed
  Worker ignores it and logs `auth.development_mode_ignored` when it is set.
- Verify the client sends one of the supported proxy authentication formats.
- Confirm the key was deployed to the same Wrangler environment as the code.
- A Bearer header must contain the proxy key, not the provider key.

### Provider returns HTTP 401 or 403

- Run authenticated `/status` and inspect only the affected provider.
- Redeploy the configuration after changing a key.
- Confirm the direct route name and environment-variable name in
  [Configuration](configuration.md).
- For Workers AI, configure both the account ID and API token.

### A provider is absent from `/v1/models`

The endpoint omits unavailable, unsupported, timed-out, and malformed provider
responses. Amazon Bedrock and Azure OpenAI are unavailable for model discovery
until all of their required local credentials and routing identifiers are
configured, including with `ALWAYS_USE_AI_GATEWAY=true`. Check `/status` and
Worker logs. For a custom endpoint, set `models` to a static list if its model
endpoint is missing or slow.

### `/g/<name>/...` returns 400 or a provider route fails

The dynamic Gateway prefix requires `CLOUDFLARE_ACCOUNT_ID`. The default Gateway
also requires `AI_GATEWAY_NAME`. Confirm that the provider is in the supported
AI Gateway set and that the path follows the patterns in [HTTP API and
routing](api.md).
When the account ID is absent, the proxy returns HTTP 400 with an explicit
configuration message before provider routing.

With `ALWAYS_USE_AI_GATEWAY=true`, an absent `AI_GATEWAY_NAME` intentionally
selects `default`. If a `custom-llm-proxy-*` route returns 404, rerun
`npm run secrets:deploy` and confirm that `CLOUDFLARE_API_TOKEN` has AI Gateway
Write permission. The command fails before applying secrets when a generated
slug is already owned by an unrelated account-level Custom Provider; resolve
that collision explicitly rather than renaming or deleting providers blindly.

### Custom Provider synchronization fails

- `ALWAYS_USE_AI_GATEWAY=true` requires both `CLOUDFLARE_ACCOUNT_ID` and a
  `CLOUDFLARE_API_TOKEN` with `AI Gateway - Edit` permission.
- Use `npm run secrets:deploy -- --dry-run` to validate configuration without
  contacting Cloudflare. The dry run cannot verify account permissions or
  existing provider ownership.
- A real deployment creates or updates required definitions but deliberately
  does not delete stale `LLM Proxy / ...` providers. Review and remove stale
  account resources separately after confirming they are unused.
- Do not publish the configuration, API response body, Custom Provider Base
  URLs, or tokens when investigating a failure.

### An `/ai/...` request returns 400, 401, or 403

- HTTP 400 from the proxy means `CLOUDFLARE_ACCOUNT_ID` or
  `CLOUDFLARE_API_TOKEN` is missing.
- For HTTP 401 or 403 from Cloudflare, confirm that `CLOUDFLARE_API_TOKEN` is a
  Cloudflare API token with AI Gateway permission for the account.
- Confirm the selected Gateway exists and has credits when calling a third-party
  provider.
- Workers AI model IDs must begin with `@cf/`; third-party model IDs use
  `<provider>/<model>`.

### Local development does not start

`npm run dev` reads `config.develop.jsonc`, generates `.dev.vars.develop`, starts
Wrangler, and removes the generated file on exit. Confirm that the source file
exists and contains valid JSONC. If a previous process was terminated abruptly,
delete the generated `.dev.vars.develop` file and retry; do not commit it.
Top-level `null` values are omitted from the local dotenv file; they remain
deployment deletion instructions only.

### Key selection behaves unexpectedly

- Indices are zero-based.
- A single index wraps modulo the number of configured keys.
- Ranges choose randomly and are inclusive.
- With no explicit prefix, multiple keys use striped per-isolate round-robin.
- `/v1/models` uses the first key unless a prefix is present.
- A `provider:profile` selector limits rotation, cooldowns, and explicit key
  indices to that profile; omitting the suffix selects `default`.
- Only chat, Responses, Messages, models, and registered provider pass-through
  accept the prefix; health, Gateway REST, compatibility pass-through,
  Universal, and unknown routes return HTTP 400.

## Rollback

Code and secrets have independent histories. Roll back the Worker deployment
using the Cloudflare deployment/version controls appropriate to the environment,
then redeploy the exact previous configuration from a secure local copy. Verify
both `/status` and a real provider request; rolling back only one side can leave
code and configuration incompatible.
