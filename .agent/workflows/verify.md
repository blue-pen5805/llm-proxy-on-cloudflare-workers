---
description: Verify types, formatting, lint, and tests
---

Run every command from the repository root. Stop and investigate a failure; do
not report the workflow as successful unless all four checks pass.

1. Check TypeScript types.

```bash
npm run tsc
```

2. Check formatting without modifying files.

```bash
npm run prettier-ci
```

If this fails, format the repository, review the resulting diff, and rerun the
check:

```bash
npm run prettier
```

3. Run ESLint.

```bash
npm run lint
```

4. Run the test suite once in CI mode.

```bash
npm run test
```

Record the commands and pass/fail outcome in the final task handoff. Do not add
generated logs or a verification-only Markdown file to the repository.
