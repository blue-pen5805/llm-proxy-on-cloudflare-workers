# Operations and Troubleshooting

## Deployment checklist

1. Run `npm ci` on a clean checkout.
2. Create or update the target `config[.<env>].jsonc` outside version control.
   For a named environment, first declare the matching environment in
   `wrangler.jsonc`.
3. Preview settings with `npm run secrets:deploy -- --dry-run [--env <env>]`.
   The current dry-run output includes secret values, so use it only in a
   private terminal and never attach it to CI logs or support reports.
4. Run `npm run tsc`, `npm run lint`, and `npm test`.
5. Deploy code with `npm run deploy` (or `npm run deploy -- --env <env>` for a
   declared Wrangler environment).
6. Deploy settings with `npm run secrets:deploy -- [--env <env>]`.
7. Verify `/ping`, then authenticated `/status`, `/v1/models`, and one real
   request for each critical provider.

The code deployment and secret deployment are separate. A successful Worker
deployment does not prove that the expected secrets exist in the same Wrangler
environment.

The repository's secret deployment script prints each non-empty setting with up
to the first 20 characters of its value before invoking Wrangler. Treat normal
deployment output as sensitive too; do not retain it in public CI logs.

## Safe configuration changes

- Keep `config.jsonc`, environment-specific variants, `.dev.vars*`, and
  `.secrets-temp.json` out of version control.
- Use distinct `PROXY_API_KEY` values per environment.
- Replace a provider key in the configuration, deploy secrets, verify it, and
  only then revoke the old key at the provider.
- When changing an array's order with global round-robin enabled, expect the
  stored index to continue against the new array. It is bounded to the new
  length, but does not track key identity.
- Treat `CF_AIG_TOKEN` and the entire `CUSTOM_OPENAI_ENDPOINTS` value as secrets.

## Observability

Workers Logs are enabled for every invocation in `wrangler.jsonc`; traces use
head sampling. Application records are structured JSON and can be filtered by
their `event` and `request_id` fields. Start with `request.completed` for status
and handler latency, then correlate `subrequest.completed`,
`subrequest.failed`, or provider-specific failure events using the same request
ID.

Inbound logs contain the path but exclude the query string. Upstream URLs mask
recognized credential parameters. Error messages are redacted and truncated;
headers, payloads, stack traces, and arbitrary thrown objects are not recorded.
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
- `/status` makes one model-list request per configured key. It can be slow,
  consume provider quota, and expose limited configuration metadata.
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
responses. Check `/status` and Worker logs. For a custom endpoint, set `models`
to a static list if its model endpoint is missing or slow.

### `/g/<name>/...` returns 404 or bypasses Gateway

The dynamic Gateway prefix requires `CLOUDFLARE_ACCOUNT_ID`. The default Gateway
also requires `AI_GATEWAY_NAME`. Confirm that the provider is in the supported
AI Gateway set and that the path follows the patterns in [HTTP API and
routing](api.md).

### Local development does not start

`npm run dev` reads `config.develop.jsonc`, generates `.dev.vars.develop`, starts
Wrangler, and removes the generated file on exit. Confirm that the source file
exists and contains valid JSONC. If a previous process was terminated abruptly,
delete the generated `.dev.vars.develop` file and retry; do not commit it.

### Key selection behaves unexpectedly

- Indices are zero-based.
- A single index wraps modulo the number of configured keys.
- Ranges choose randomly and are inclusive.
- With no explicit prefix, multiple keys are random unless
  `ENABLE_GLOBAL_ROUND_ROBIN=true`.
- `/v1/models` uses the first key unless a prefix is present.

## Rollback

Code and secrets have independent histories. Roll back the Worker deployment
using the Cloudflare deployment/version controls appropriate to the environment,
then redeploy the exact previous configuration from a secure local copy. Verify
both `/status` and a real provider request; rolling back only one side can leave
code and configuration incompatible.
