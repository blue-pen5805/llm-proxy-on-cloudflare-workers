# Development and Verification

For contributors changing proxy code, configuration definitions, or dependencies.
Deployment and operator-owned settings follow [initial setup](../user/initial-setup.md)
and [operations](../user/operations.md).

## Local setup

```bash
npm ci
cp config.example.jsonc config.develop.jsonc
```

Replace placeholders in `config.develop.jsonc`, set `DEV` deliberately, and run:

```bash
npm run dev
```

The command generates `.dev.vars.develop` for the lifetime of cf and
removes it on normal exit. `cf dev --mode develop` loads this file and uses the
`llm-proxy-develop` Worker configuration. Both files are ignored by Git.

### Local development does not start

Confirm `config.develop.jsonc` exists and contains valid JSONC. If cf was
terminated abruptly, remove the generated `.dev.vars.develop` and retry
`npm run dev`. Keep both files out of Git. Top-level `null` values are omitted
locally; they request secret deletion only during deployment.

## Cloudflare tooling

The project uses the beta Cloudflare CLI, `cf`. `cloudflare.config.ts` owns
Worker deployment settings. `cf` uses its internal Wrangler bundler with default
settings, including automatic type generation during development and builds.
Vitest takes the entry point, compatibility date, and compatibility flags from
`cloudflare.config.ts` and passes them directly to `@cloudflare/vitest-plugin`.
The plugin runs tests in the Workers runtime and requires Vitest `^4.1.0`; keep
`vitest` and `@vitest/coverage-istanbul` on matching versions. See the official
[Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/).
No separate Wrangler configuration file is needed.

Node.js 22.18 or later is required to load the TypeScript configuration.
The project has no install-time lifecycle script. `npm run tsc` generates
`.cloudflare/types/index.d.ts` before type checking, including in CI and
`npm run verify`. Generate the types separately with `npm run cf-typegen`
when needed by the editor; the directory is ignored.
Application binding names come from the configuration schema in `src/env.d.ts`.
They are not declared as required secrets because providers and settings are
optional and validated by the application.

```bash
npm run build
npm run deploy -- --dry-run
```

These checks build and package the Worker without uploading it. For CLI
configuration and commands, see the official
[cf migration reference](https://developers.cloudflare.com/cf/wrangler/reference/).

Use `npx cf auth logout` to sign out of the local Cloudflare CLI session.

## Project map

| Path               | Responsibility                                     |
| ------------------ | -------------------------------------------------- |
| `src/index.ts`     | Hono Worker entry point and middleware order       |
| `src/routing.ts`   | Hono endpoint declarations and namespace guards    |
| `src/middlewares/` | Cross-cutting request processing                   |
| `src/requests/`    | Route handlers                                     |
| `src/providers/`   | Provider adapters and request translation          |
| `src/ai_gateway/`  | Cloudflare AI Gateway URL and payload construction |
| `src/utils/`       | Configuration, secrets, key selection, and helpers |
| `scripts/`         | Local config and cf secret tooling                 |
| `schemas/`         | JSON Schema for configuration files                |
| `test/`            | Unit and Worker-runtime tests                      |

See [Design documentation](design/overview.md) before changing request flow,
provider behavior, authentication, or key rotation.

## Hono tools and skill

`hono` is the runtime framework; `@hono/cli` is a development dependency.
`npm ci` installs the versions recorded in `package-lock.json`. The CLI uses the
`next` release specified by the official Hono skill for its agent commands.

```bash
npm run hono -- agent-context
npm run hono:routes
```

`hono:routes` inspects `src/routing.ts`, the authenticated endpoint application,
with `--verbose` so handlers that accept `next`, including the compatibility
endpoint and namespace guards, appear in the output.
Inspect entry middleware separately with
`npm run hono -- routes src/index.ts --verbose`. The provider wildcard uses the
configured registry; its concrete provider names are not static Hono routes.

Use `cf dev` for local Worker requests so the real Workers runtime supplies
bindings and an ExecutionContext. Start the server and issue HTTP requests
from another terminal:

```bash
# First terminal: generates .dev.vars.develop and starts cf dev --mode develop
npm run dev

# Second terminal: preflight requires no credentials
curl -i -X OPTIONS http://127.0.0.1:8787/ping
```

The current Hono CLI's `request --runtime workerd` requires a legacy Wrangler
configuration and is not used in this project. Keep Hono CLI for route
inspection; do not substitute its Node runtime for Worker integration checks.
For authenticated automated tests, pass fake bindings and
`createExecutionContext()` to `app.request()` in Workers Vitest, as in
`test/src/hono_integration.test.ts`. Keep real credentials out of CLI arguments
and test fixtures.

The [Hono skill](../../.agents/skills/hono/SKILL.md) is bundled in
`.agents/skills/hono/`, with its upstream MIT license, for sharing through Git.
[Codex discovers repository skills](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
in `.agents/skills/`; no separate personal installation is required.
The skill comes from [honojs/skills](https://github.com/honojs/skills). Local
adjustments include Markdown formatting, removal of an upstream release TODO,
and routing Worker runtime checks through `cf dev`;
review upstream updates before replacing the bundled copy.

The skill's API reference and the installed CLI's `agent-context` output guide
Hono work; repository security and request-processing contracts remain
authoritative. See also the
[Hono CLI reference](https://github.com/honojs/cli) and
[Hono testing guide](https://hono.dev/docs/guides/testing).

## Adding or changing configuration

First classify the value as a secret, non-secret setting, or Worker binding.
This project's local JSONC deployment path registers top-level values as Worker
secrets, so never place a live value in a tracked file.

Keep the following artifacts synchronized:

1. `schemas/config-schema.json`
2. `config.example.jsonc` with a non-secret placeholder
3. configuration access in `src/utils/config.ts` or `src/utils/secrets.ts`
4. scripts that enumerate fields, especially `scripts/create-config.ts`
5. tests for schema parsing, defaults, invalid input, script behavior, and
   runtime access as applicable
6. [Configuration reference](../user/configuration.md) and the relevant design document
   when behavior or architecture changes

After changing the schema, run `npm run cf-typegen`; do not edit
`.cloudflare/types/index.d.ts` manually.

## Adding a provider

1. Add a `defineProvider` definition under `src/providers/<name>/`. Set
   `openAICompatible: true` when the provider uses JSON and Bearer authentication,
   and declare only the values or hooks that differ from the shared behavior.
   Group operation definitions in `endpoints`. Use
   `chat_completions: chatCompletionsEndpoint(path, options)` for Chat filtering
   and `jsonEndpoint(pathOrPrepare, options)` for native APIs. Put model-list
   paths, `validate`, `convertResponse`, `getStaticModels`, `supportsAiGateway`,
   and `requiresProviderCredentials` in `endpoints.models` as applicable.
   Omit unsupported operations. Declare `chatFallback` with
   `convertedChatEndpoint(codec)` when translation is needed, and use
   `resolveEndpoint` / `resolveChatFallback` for model-specific selection.
   Test both direct and Gateway targets; `prepareGateway` handles differences
   in their upstream APIs.
2. Register its route in `src/providers.ts`.
3. Add its key to the schema, example configuration, creation script, and docs.
4. Add contract tests for availability, headers, URL construction, model
   translation, and chat translation as supported.
5. Update `src/ai_gateway/const.ts` only when current Cloudflare AI Gateway
   documentation or a documented and tested operational compatibility contract
   confirms support.
6. Update the provider-abstraction design document when behavior changes.

Do not claim OpenAI chat or model-list compatibility merely because pass-through
works; test each capability independently.

## Updating dependencies

Update one dependency or a tightly related group at a time:

1. Inspect available versions with `npx npm-check-updates`.
2. Read upstream release and migration notes for the selected packages.
3. Run `npx npm-check-updates --upgrade PACKAGE_NAME`, then `npm install`.
4. Review both `package.json` and `package-lock.json` for unrelated updates.
5. Regenerate and compare Worker bindings with `npm run cf-typegen` when
   cf, Workers types, or configuration behavior changes.
6. Run the complete verification workflow below.

If a reported vulnerability cannot be resolved in the same update, record in
the review or issue: the affected package and dependency path, advisory and
severity, whether it reaches the deployed Worker bundle, the concrete
acceptance rationale, compensating controls, an owner, and a `YYYY-MM-DD`
re-evaluation date. An unowned or undated acceptance is not complete.

Update documentation only when the dependency changes architecture, supported
runtimes, commands, configuration behavior, or the contributor workflow. If the
update cannot be made compatible within scope, report the exact failure and
leave unrelated worktree changes untouched.

## Required verification

For changes to code, configuration schemas/examples or tooling, or dependencies,
run all repository checks from the root:

```bash
npm run verify
```

The verification command runs type checking, formatting, linting, and the full
test suite with coverage in that order. Use `npm run test` when coverage is not
needed for a faster test-only run.

For interactive testing, use `npx vitest watch`. Apply automatic lint fixes with
`npm run lint -- --fix`.

Coverage is a required contract: statements, branches, functions, and lines
must each remain at 100%. Add meaningful assertions for reachable behavior.
Use narrowly scoped Istanbul exclusions only for structurally unreachable or
runtime-only code, and document the reason inline at every exclusion.

Coverage measures which lines ran, not which inputs were tried, so it does not
by itself establish that a route behaves under hostile input. When a change
introduces or touches a name, path, or field that a client controls, add a case
to `test/src/security/adversarial_inputs.test.ts` asserting the documented
rejection rather than relying on the coverage percentage.

Test doubles must implement the same callable contract as production provider
instances, preferably by constructing or extending the real provider
implementation and overriding only the behavior under test. Do not preserve an
unreachable implementation branch solely to satisfy coverage, and do not
invent a partial provider shape to enter such a branch; remove structurally
unreachable code instead.

`npm run tsc` checks source/scripts, Worker tests, and Node tooling tests as
separate projects because Workers and Node global types conflict. Oxlint covers
`src`, `scripts`, and `test`; source and scripts also use type-aware
`typescript/no-floating-promises`. Await Promises used in control flow; mark
intentional background work with `void` and handle rejection.

If the formatting check fails, run `npm run format`, review every resulting
change, and repeat the checks. Performance-sensitive changes also require the
[measurement workflow](#performance-measurement).

For documentation-only changes, at minimum:

1. Run Oxfmt against the changed Markdown files.
2. Check relative links and referenced repository paths.
3. Compare commands, routes, configuration names, and behavior with their
   authoritative implementation files.
4. Run `git diff --check`.

Run the broader checks when documentation exposes uncertainty about the
implementation or when formatting changes non-documentation files. In every
case, inspect the final diff for credentials, local configuration, generated
secret files, and unrelated changes. Report any command that was not run or did
not pass; do not create repository files solely to store verification output.

Real-provider Chat Completions checks are intentionally excluded from the
required test suite because they require operator credentials and incur cost.
Use the separate [live provider testing guide](live-provider-testing.md) when
validating the local development server against current provider models.

## Performance measurement

Run `npm run bench` for performance-sensitive changes. It exercises request
building, routing, and Responses, Messages, and metadata SSE transformations.
Record the command, Node version, machine, input, benchmark name, mean, and
variance; compare only matching environments and inputs. Benchmarks are
diagnostic, while tests and coverage enforce correctness. Use Workers CPU
metrics to assess production cost independently of upstream latency.

## Package version

Propose a semantic version after each change: patch for compatible fixes or
maintenance, minor for compatible functionality, major for incompatible API or
behavior. Update `package.json` and `package-lock.json` together only after
explicit operator confirmation.

## Documentation maintenance

- Place user and operator guides under `docs/user/`, API references under
  `docs/user/api/`, and contributor guides under `docs/developer/`. Keep design
  documents under `docs/developer/design/`.

- User guides describe configuration, deployment, API usage, and troubleshooting
  through observable behavior. Require only checks needed to use or operate the
  application, such as configuration preview and authenticated requests.
- Contributor guides describe source changes, tests, coverage, linting, type
  checking, and benchmarks. Keep these checks out of routine user setup and
  deployment instructions.

- The Japanese README and initial setup guide are maintained separately. Other
  documentation is English-only.
- All files under `docs/developer/design/` are English and focus on rationale and
  structure rather than step-by-step usage.
- Link new design documents from `docs/developer/design/overview.md` and new user guides
  from `docs/index.md`.
- Prefer repository-relative examples and placeholders over personal URLs,
  accounts, provider keys, or environment names.
- Verify commands against `package.json`, settings against the JSON Schema, and
  routes against `src/routing.ts` before publishing changes.
