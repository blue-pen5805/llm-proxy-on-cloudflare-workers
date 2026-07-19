# Development and Verification

## Local setup

```bash
npm ci
cp config.example.jsonc config.develop.jsonc
```

Replace placeholders in `config.develop.jsonc`, set `DEV` deliberately, and run:

```bash
npm run dev
```

The command generates `.dev.vars.develop` for the lifetime of Wrangler and
removes it on normal exit. Both files are ignored by Git.

## Project map

| Path               | Responsibility                                     |
| ------------------ | -------------------------------------------------- |
| `src/index.ts`     | Worker entry point and middleware order            |
| `src/middlewares/` | Cross-cutting request processing                   |
| `src/requests/`    | Route handlers                                     |
| `src/providers/`   | Provider adapters and request translation          |
| `src/ai_gateway/`  | Cloudflare AI Gateway URL and payload construction |
| `src/utils/`       | Configuration, secrets, key selection, and helpers |
| `scripts/`         | Local config and Wrangler secret tooling           |
| `schemas/`         | JSON Schema for configuration files                |
| `test/`            | Unit and Worker-runtime tests                      |

See [Design documentation](design/overview.md) before changing request flow,
provider behavior, authentication, or key rotation.

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
6. [Configuration reference](configuration.md) and the relevant design document
   when behavior or architecture changes

After changing the schema, run `npm run cf-typegen`; do not edit
`worker-configuration.d.ts` manually.

## Adding a provider

1. Add a `defineProvider` definition under `src/providers/<name>/`. Set
   `openAICompatible: true` when the provider uses JSON and Bearer authentication,
   and declare only the values or hooks that differ from the shared behavior.
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
   Wrangler, Workers types, or configuration behavior changes.
6. Run the complete verification workflow below.

Update documentation only when the dependency changes architecture, supported
runtimes, commands, configuration behavior, or the contributor workflow. If the
update cannot be made compatible within scope, report the exact failure and
leave unrelated worktree changes untouched.

## Required verification

For code, configuration, or dependency changes, run all repository checks from
the root:

```bash
npm run tsc
npm run prettier-ci
npm run lint
npm run test
npm run test:coverage
```

Coverage is a required contract: statements, branches, functions, and lines
must each remain at 100%. Add meaningful assertions for reachable behavior.
Use narrowly scoped Istanbul exclusions only for structurally unreachable or
runtime-only code, and document the reason inline at every exclusion.

ESLint uses the TypeScript project service for `src` and `scripts` so
Promise-returning expressions are checked by
`@typescript-eslint/no-floating-promises`. Await a Promise when its result is
part of control flow; otherwise mark intentional fire-and-forget work with
`void` and handle rejection where applicable.

If the formatting check fails, run `npm run prettier`, review every resulting
change, and repeat the checks. Run `npm run bench` for performance-sensitive
changes; benchmarks are diagnostic and must be compared under the same runtime
and machine.

For documentation-only changes, at minimum:

1. Run Prettier against the changed Markdown files.
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

## Changelog and package version

Add `CHANGELOG.md` entries only for changes to application functionality or
externally observable runtime behavior. Documentation, contributor guidance,
project policy, development process, tests, refactors, and maintenance with no
functional effect do not belong in the changelog.

When finishing a work session with changelog-worthy changes, derive the entries
from the net difference between the state at the start of the session and the
final state. Describe only the resulting functionality or behavior. Do not
record intermediate revisions, superseded directions, or approaches that were
later reverted; consolidate related work into concise entries instead. Add the
entries at the top of the applicable section, include the change date in
`YYYY-MM-DD` format, and keep entries in reverse chronological order; for
multiple entries on the same date, put the newest entry first. Keep pending
changes under `Unreleased` until a versioned release is prepared.

After completing the change, assess its semantic-versioning impact:

- `patch` for backward-compatible fixes and maintenance changes
- `minor` for backward-compatible functionality
- `major` for incompatible API or behavior changes

Propose the resulting `package.json` version to the operator. Do not change the
version number without their explicit confirmation. When a version change is
approved, keep `package.json`, `package-lock.json`, and the version heading in
`CHANGELOG.md` synchronized.

The next release is currently planned as `1.0.0`. This plan does not authorize
a version change: keep the package at `0.2.1` until the operator explicitly
approves the update.

## Documentation maintenance

- The Japanese README and initial setup guide are maintained separately. Other
  documentation is English-only.
- All files under `docs/design/` are English and focus on rationale and
  structure rather than step-by-step usage.
- Link new design documents from `docs/design/overview.md` and new user guides
  from `docs/index.md`.
- Prefer repository-relative examples and placeholders over personal URLs,
  accounts, provider keys, or environment names.
- Verify commands against `package.json`, settings against the JSON Schema, and
  routes against `src/middlewares/router.ts` before publishing changes.
