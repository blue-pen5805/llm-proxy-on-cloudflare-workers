---
description: Add or change a Worker environment setting safely
---

1. Classify the value as a secret, non-secret setting, or binding. This project
   deploys values from local JSONC as Worker secrets; never add a live value to a
   tracked file.
2. Add the setting shape to `schemas/config-schema.json`.
3. Add a safe placeholder and explanatory comment to `config.example.jsonc`.
4. Update the runtime reader in `src/utils/config.ts` or `src/utils/secrets.ts`.
5. Update any scripts with explicit field lists, especially
   `scripts/create-config.ts`.
6. Update `docs/configuration.md`. Update a design document when the setting
   changes application behavior or architecture.
7. Add or update tests for schema parsing, script behavior, defaults, invalid
   input, and runtime access as applicable.
8. Regenerate Worker binding types. Never edit `worker-configuration.d.ts`
   manually.

```bash
npm run cf-typegen
```

9. Run `.agent/workflows/verify.md` and review the final diff for credentials.
