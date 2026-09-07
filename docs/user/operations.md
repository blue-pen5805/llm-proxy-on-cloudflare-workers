# Operations and Troubleshooting

## Deployment checklist

Follow [initial setup](initial-setup.md) for installation and deployment. For
updates:

1. Edit the target configuration and preview it with
   `npm run secrets:deploy -- --dry-run [--env <env>]`.
2. Deploy code with `npm run deploy -- [--env <env>]` and settings with
   `npm run secrets:deploy -- [--env <env>]` to the same Wrangler environment.
3. Check `/ping`, `/status`, `/v1/models`, and a real request for each critical
   provider. Review diagnostic output privately.

Bracketed arguments are optional; declare named environments in
`wrangler.jsonc`. Code and secret deployments are separate operations.

## Safe configuration changes

- Keep `config.jsonc`, environment-specific variants, `.dev.vars*`, and
  `.secrets-temp*.json` out of version control.
- Use distinct `PROXY_API_KEY` values per environment.
- Follow [configuration update rules](configuration.md#configuration-files) for
  deletions, dependent settings, and size limits.
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
is in [Monitoring and diagnostics](../developer/design/features/monitoring_diagnostics.md#platform-observability).

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

Workers Free permits 50 subrequests per invocation. Large model or credential
sets can exceed this budget; check the [Workers subrequest
limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests)
when sizing a deployment.

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
responses. Automatic discovery retries sequential later keys after HTTP 429,
up to three attempts, and still omits the provider if every attempt fails.
Amazon Bedrock and Azure OpenAI are unavailable for model discovery
until all of their required local credentials and routing identifiers are
configured, including with `ALWAYS_USE_AI_GATEWAY=true`. Check `/status` and
Worker logs. For a custom endpoint, set `models` to a static list if its model
endpoint is missing or slow.

### `/g/<name>/...` returns 400 or a provider route fails

The dynamic Gateway prefix requires `CLOUDFLARE_ACCOUNT_ID`. Unprefixed
Gateway routing uses `AI_GATEWAY_NAME` when set, and otherwise `default` when
`ALWAYS_USE_AI_GATEWAY=true` or an `/ai` REST path is requested. Confirm that
the provider is in the supported AI Gateway set and that the path follows the
patterns in [HTTP API and routing](api/overview.md).
When the account ID is absent, the proxy returns HTTP 400 with an explicit
configuration message before provider routing.

With `ALWAYS_USE_AI_GATEWAY=true`, an absent `AI_GATEWAY_NAME` intentionally
selects `default`. If a `custom-llm-proxy-*` route returns 404, rerun
`npm run secrets:deploy` and confirm that `CLOUDFLARE_API_TOKEN` has
`AI Gateway - Edit` permission. The command fails before applying secrets when
a generated slug is already owned by an unrelated account-level Custom
Provider; resolve that collision explicitly rather than renaming or deleting
providers blindly.

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

### Key selection behaves unexpectedly

Check the selected `provider:profile` and the zero-based index within that pool.
See [explicit selection](api/overview.md#explicit-key-selection) for index/range rules
and supported routes, and [key rotation](../developer/design/features/key_rotation.md) for
automatic selection, cooldowns, and model-discovery retries.

## Rollback

Code and secrets have independent histories. Roll back the Worker deployment
using the Cloudflare deployment/version controls appropriate to the environment,
then redeploy the exact previous configuration from a secure local copy. Verify
both `/status` and a real provider request; rolling back only one side can leave
code and configuration incompatible.
