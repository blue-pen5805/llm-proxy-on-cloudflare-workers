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
removes it on normal exit. Both files are ignored by Git. Durable Objects are
provided by the local Wrangler runtime.

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

Keep the following artifacts synchronized:

1. `schemas/config-schema.json`
2. `config.example.jsonc` with a non-secret placeholder
3. configuration access in `src/utils/config.ts` or `src/utils/secrets.ts`
4. scripts that enumerate fields, when applicable
5. [Configuration reference](configuration.md)

After changing the schema, run `npm run cf-typegen`; do not edit
`worker-configuration.d.ts` manually.

## Adding a provider

1. Implement a `ProviderBase` or `OpenAICompatibleProvider` adapter under
   `src/providers/<name>/`.
2. Register its route in `src/providers.ts`.
3. Add its key to the schema, example configuration, creation script, and docs.
4. Add contract tests for availability, headers, URL construction, model
   translation, and chat translation as supported.
5. Update `src/ai_gateway/const.ts` only when current Cloudflare AI Gateway
   documentation confirms support.
6. Update the provider-abstraction design document when behavior changes.

Do not claim OpenAI chat or model-list compatibility merely because pass-through
works; test each capability independently.

## Required verification

Run the repository checks from the root:

```bash
npm run tsc
npm run prettier
npm run lint
npm run test
```

`npm run prettier` modifies files. Review the resulting diff and make sure no
local configuration or generated secret file was added. For documentation-only
changes, also verify all relative Markdown links and inspect rendered tables and
code fences.

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
