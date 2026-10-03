# Upgrade to 1.0.0

English | [日本語](upgrade_ja.md)

Use this procedure for an existing deployment. It assumes you have the 1.0.0
source tree; the version number does not by itself mean a release tag has been
published. For a new Worker, use [initial setup](initial-setup.md).

## 1. Preserve the current deployment settings

Record the deployed code revision, Cloudflare account, Worker name, routes,
custom domains, bindings, and any named environments. Keep a private backup of
the active `config.jsonc` or `config.<env>.jsonc` and deployment configuration.
Do not overwrite an existing configuration with `config.example.jsonc`.

Use Node.js 22.18 or later. In the 1.0.0 source directory, run:

```bash
npm pkg get version
npm ci
npm run cf:login
```

The version command must print `"1.0.0"`. `cf` has its own login even if Wrangler
is already authenticated. The configuration editor is `npm run secrets`.

## 2. Select the existing Worker

Deployment uses `cloudflare.config.ts`. Transfer operator-specific settings from
your deployment configuration to this file: especially the Worker name, routes,
domains, and bindings. Match the existing Worker rather than creating a new one
under the default name. The supplied modes are the default `llm-proxy` and
`develop` (`llm-proxy-develop`); define any other modes explicitly before use.

Keep the `KeyRotationManager` deletion declaration. Deployments with that Durable
Object namespace need it to retire the namespace; key rotation is per isolate.
This deletes rotation state. An older code version that requires the namespace
cannot be restored by assuming a code-only rollback will recreate it.
See [deployment design](../developer/design/features/security_config.md#deployment-tooling)
and the [cf configuration mapping](https://developers.cloudflare.com/cf/wrangler/reference/).

### Update Cloudflare Workers Builds settings

If the Worker is connected to Git through Workers Builds, **update the dashboard
build settings as well as the repository** before the next automatic deployment.
Open **Workers & Pages → your Worker → Settings → Build** and edit the build
configuration:

| Setting           | Default Worker                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Build command     | `npm run build`                                                                                                      |
| Deploy command    | `npm run deploy -- --prebuilt`                                                                                       |
| Root directory    | The repository directory containing `package.json` and `cloudflare.config.ts` (the repository root for this project) |
| Production branch | The branch from which you intend to deploy the release, normally `main`                                              |

Replace a saved `npx wrangler deploy` command: this project uses
`cloudflare.config.ts` and no longer includes `wrangler.jsonc`. The npm scripts
run the project's pinned `cf` CLI. `cf deploy` builds by default, so
`npm run build` followed by `npm run deploy` also works but builds twice.
`--prebuilt` deploys the preceding build's `.cloudflare/output` instead.
Alternatively, leave the build command empty and use `npm run deploy` alone.

For a separate `develop` Worker, use `npm run build -- --mode develop` and
`npm run deploy -- --prebuilt --mode develop`. Build and deploy modes must match.
The default Worker in this repository uses no `--mode`; do not add
`--mode production`, which is not declared in its configuration.

Use Node.js 22.18 or later in the build environment. CI authentication uses
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; verify the Workers Builds
token/account settings for the target Worker instead of running interactive
`cf:login` in CI. Runtime provider secrets are separate from build variables;
the build/deploy commands do not upload the ignored local `config.jsonc`.
Apply runtime configuration separately using step 4.

If preview builds are enabled, update their separate Preview command too. The
cf equivalent is `npx cf previews deploy`, which creates its own preview build.
It must not use the ordinary build's `--prebuilt` output or the production deploy
command. Add `--mode` only when that mode is explicitly configured.

References: [Workers Builds settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[cf in CI](https://developers.cloudflare.com/cf/ci/), and
[prebuilt deployments and modes](https://developers.cloudflare.com/cf/projects/#deploy-a-prebuilt-build).

## 3. Prepare configuration and clients

Keep the same proxy key where possible so clients do not need a new credential.
Check these 1.0.0 requirements against your configuration and integrations:

| Area             | Required configuration or behavior                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication   | Use `Authorization: Bearer <key>`, `x-api-key`, or `x-goog-api-key`. Query-string authentication is unsupported; deployed Workers require a proxy key and ignore `DEV`.                                                                                                                 |
| Multiple keys    | Use a JSON array such as `["example-key-one", "example-key-two"]`. A comma inside a scalar string is part of one key.                                                                                                                                                                   |
| Custom endpoints | Use HTTPS, unique names that do not collide with built-in providers, and the documented [configuration limits](configuration.md#custom-openai-compatible-endpoints).                                                                                                                    |
| Virtual models   | When deploying custom endpoints, an omitted `VIRTUAL_MODELS` key means `null` and deletes any deployed virtual-model setting. Include its final value if you use virtual models. Setting virtual models without custom endpoints similarly deletes the omitted custom-endpoint setting. |
| Partial updates  | Omitting both dependent settings preserves both. Deleting virtual models alone preserves custom endpoints. Explicitly empty dependent values remain no-ops; use `null` for deletion.                                                                                                    |
| Rotation         | Remove `ENABLE_GLOBAL_ROUND_ROBIN`. Rotation is per isolate; there is no global ordering guarantee.                                                                                                                                                                                     |
| Monitoring       | `/status` identifies keys by `slot`. Proxy-local OpenAI errors use an `error` object with `message`, `type`, `param`, and `code`.                                                                                                                                                       |

An existing configuration that sets custom endpoints but has never defined
`VIRTUAL_MODELS` can be used without adding that key. The deployment helper
resolves the omission in memory and does not rewrite your file. Other omitted
settings retain their deployed values. See the complete
[configuration update rules](configuration.md#configuration-files).

## 4. Preview, test, and deploy

Preview the target configuration before making changes to Cloudflare:

```bash
npm run secrets:deploy -- --dry-run
```

Review the setting names and `[set]` / `[delete]` operations, including any deletion
introduced by an omitted dependent key. A dry run is offline and does not verify
Cloudflare permissions. Test on a separate Worker first. Code and secrets are
separate deployments, so allow for the interval between them when scheduling the
production update.

For the default Worker, deploy code first, then its secrets:

```bash
npm run deploy
npm run secrets:deploy
```

For the supplied `develop` mode, use `config.develop.jsonc` and:

```bash
npm run secrets:deploy -- --env develop --dry-run
npm run deploy -- --mode develop
npm run secrets:deploy -- --env develop
```

Use matching mode names for code and secrets. Custom mode names must already be
declared in `cloudflare.config.ts`.

## 5. Verify and retain a recovery copy

With the existing client credential, confirm `/ping` returns `Pong`, inspect
`/status` privately, and request `/v1/models` with `Cache-Control: no-cache` to
refresh discovery. Test a normal and a streaming inference request for each
critical provider and any custom or virtual models you use. Check clients that
consume diagnostics and error bodies as well.

For failures, use [operations and troubleshooting](operations.md). Keep the
previous code and configuration until verification is complete. Code and secret
history are independent; recovery must restore a compatible pair and account for
the Durable Object deletion described above.
