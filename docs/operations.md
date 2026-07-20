# Operations and Troubleshooting

## Deployment checklist

1. Run `npm ci` on a clean checkout.
2. Create or update the target `config[.<env>].jsonc` outside version control.
   For a named environment, first declare the matching environment in
   `wrangler.jsonc`.
3. Preview settings with `npm run secrets:deploy -- --dry-run [--env <env>]`.
   Values, prefixes, and lengths are redacted; each operation is shown as
   `[set]` or `[delete]`.
4. Run `npm run tsc`, `npm run lint`, and `npm test`.
5. Deploy code with `npm run deploy` (or `npm run deploy -- --env <env>` for a
   declared Wrangler environment).
6. Deploy settings with `npm run secrets:deploy -- [--env <env>]`.
7. Verify `/ping`, then authenticated `/status`, `/v1/models`, and one real
   request for each critical provider.

The code deployment and secret deployment are separate. A successful Worker
deployment does not prove that the expected secrets exist in the same Wrangler
environment.

The repository's secret deployment script prints setting names only. The
temporary JSON is owner-readable only and is removed after Wrangler finishes.
Generated `config.jsonc` and `.dev.vars*` files are also forced to mode `0600`;
dotenv values are quoted and escaped to prevent line injection.

## Safe configuration changes

- Keep `config.jsonc`, environment-specific variants, `.dev.vars*`, and
  `.secrets-temp*.json` out of version control.
- Use distinct `PROXY_API_KEY` values per environment.
- Set a setting to `null` and deploy secrets to delete it from the Worker.
  Omitting a setting preserves its current deployed value.
- Keep every serialized setting within Cloudflare's 5 KiB per-secret limit.
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
head sampling. Every application record has a human-readable `message` for the
Workers Observability summary and can be filtered by its structured `event` and
`request_id` fields. Messages repeat the most useful safe structured fields so
the summary identifies the provider, operation, destination, status, credential
slot, and duration when those values apply. Start with `request.completed` for
status and handler latency; it also summarizes the provider or providers
observed during the request. Then correlate `subrequest.completed`,
`subrequest.failed`, or provider-specific failure events using the same request
ID.

Inbound logs contain the path but exclude the query string. Logged upstream URLs
contain only scheme, host, and path, with every query value omitted. Error
messages are redacted using the same credential-name set as query removal and
are truncated; headers, payloads, stack traces, and arbitrary thrown objects are
not recorded.
`request.completed.duration_ms` ends when response headers are returned, so it
does not measure completion of a streamed response body. Continue to restrict
log access and retention as operational data can still be sensitive.

Filter on `provider.key.selected` to audit credential-slot usage. `key_index`
is zero based. For one-to-one provider requests, `provider_request_id`
correlates the selection with its upstream result. Universal Endpoint selection
events use a zero-based `step` because all steps share one aggregate subrequest.
`selection_policy` distinguishes explicit indexes or ranges, automatic
rotation, the default first key, and `/status` diagnostic scans. No credential
value or fingerprint is emitted. These numbers follow configuration order and
therefore change if keys are reordered.

Use health endpoints deliberately:

- `/ping` checks Worker routing without contacting providers.
- `/status` checks every configured credential against its model-list endpoint,
  five at a time. Large credential sets can make the response slow, consume
  provider quota, and expose limited configuration metadata.
- `/v1/models` is best-effort. Check Worker logs when a provider is absent.

## Common failures

### HTTP 401 from the proxy

- Confirm `DEV` is not being relied on outside local development.
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

### `/g/<name>/...` returns 404 or bypasses Gateway

The dynamic Gateway prefix requires `CLOUDFLARE_ACCOUNT_ID`. The default Gateway
also requires `AI_GATEWAY_NAME`. Confirm that the provider is in the supported
AI Gateway set and that the path follows the patterns in [HTTP API and
routing](api.md).

With `ALWAYS_USE_AI_GATEWAY=true`, an absent `AI_GATEWAY_NAME` intentionally
selects `default`. If a `custom-llm-proxy-*` route returns 404, rerun
`npm run secrets:deploy` and confirm that `CLOUDFLARE_API_TOKEN` has AI Gateway
Write permission. The command fails before applying secrets when a generated
slug is already owned by an unrelated account-level Custom Provider; resolve
that collision explicitly rather than renaming or deleting providers blindly.

### Custom Provider synchronization fails

- `ALWAYS_USE_AI_GATEWAY=true` requires both `CLOUDFLARE_ACCOUNT_ID` and a
  `CLOUDFLARE_API_TOKEN` with AI Gateway Write permission.
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

`npm run secrets:deploy` tolerates the removed
`ENABLE_GLOBAL_ROUND_ROBIN` property during migration. It prints a warning and
does not send that property to Wrangler; multi-key rotation remains enabled
regardless of the obsolete value. Remove the property from the source
configuration after seeing the warning.

### Key selection behaves unexpectedly

- Indices are zero-based.
- A single index wraps modulo the number of configured keys.
- Ranges choose randomly and are inclusive.
- With no explicit prefix, multiple keys use striped per-isolate round-robin.
- `/v1/models` uses the first key unless a prefix is present.
- Only chat, models, and registered provider pass-through accept the prefix;
  health, Gateway REST/legacy, Universal, and unknown routes return HTTP 400.

## Rollback

Code and secrets have independent histories. Roll back the Worker deployment
using the Cloudflare deployment/version controls appropriate to the environment,
then redeploy the exact previous configuration from a secure local copy. Verify
both `/status` and a real provider request; rolling back only one side can leave
code and configuration incompatible.
