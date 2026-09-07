# Initial Setup

This guide deploys a minimally configured proxy and verifies it end to end. For
all available settings, see the [Configuration reference](configuration.md).

## Prerequisites

- Node.js 22.12 or later and npm
- A Cloudflare account with permission to create Workers and secrets
- At least one supported provider credential

## 1. Install the project

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers.git
cd llm-proxy-on-cloudflare-workers
npm ci
```

## 2. Authenticate Wrangler

```bash
npm run cf:login
```

Complete the browser authorization for the Cloudflare account that will own the
Worker. The default Worker name is `llm-proxy`; change `name` in `wrangler.jsonc`
before the first deployment if necessary.

## 3. Create local configuration

Use the interactive helper:

```bash
npm run secrets
```

The terminal UI creates or safely edits `config.jsonc`, masks credentials, and
can discover the Cloudflare account from Wrangler. See
[Configuration files](configuration.md#configuration-files) for its complete
behavior and named-environment rules.

For a named environment, run
`npm run secrets -- --env <environment>`. Alternatively, copy
`config.example.jsonc` to `config.jsonc` and edit it. Set a strong, unique
`PROXY_API_KEY` and at least one provider key:

```jsonc
{
  "$schema": "schemas/config-schema.json",
  "PROXY_API_KEY": "replace-with-a-long-random-value",
  "OPENAI_API_KEY": "replace-with-your-provider-key",
}
```

Keep configuration files containing credentials private.

## 4. Preview configuration

```bash
npm run secrets:deploy -- --dry-run
```

The dry run lists setting names while redacting all values, prefixes, and
lengths.

## 5. Deploy code and configuration

```bash
npm run deploy
npm run secrets:deploy
```

These are separate operations: the first deploys Worker code and bindings, and
the second bulk-registers non-empty values from `config.jsonc` as Worker
secrets. Run the second command again whenever configuration changes.

## 6. Verify the deployment

Wrangler prints the Worker URL after deployment. Replace the example host below:

```bash
curl https://your-worker.example/ping \
  --header "Authorization: Bearer $PROXY_API_KEY"

curl https://your-worker.example/status \
  --header "Authorization: Bearer $PROXY_API_KEY"

curl https://your-worker.example/v1/models \
  --header "Authorization: Bearer $PROXY_API_KEY"
```

`/ping` should return `Pong`. Review `/status` privately because it contains
credential slot counts and configuration metadata. `/v1/models` is best-effort and
may omit a provider that times out or does not support model listing.

For model-list caching, check the [Cache API deployment
requirements](api/openai-compatible.md#models).

Next, read [HTTP API and routing](api/overview.md). For named environments, key rotation,
AI Gateway, and custom endpoints, continue with [Configuration](configuration.md)
and [Operations](operations.md).
