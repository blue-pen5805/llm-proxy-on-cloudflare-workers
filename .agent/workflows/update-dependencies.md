---
description: Update project dependencies incrementally and safely
---

1. Inspect available updates without changing files.

```bash
npx npm-check-updates
```

2. Choose one dependency or a tightly related group. Read the upstream release
   and migration notes before changing versions.

3. Update only the selected dependency and refresh the lockfile.

```bash
npx npm-check-updates --upgrade PACKAGE_NAME
npm install
```

4. Inspect both `package.json` and `package-lock.json`. Confirm that unrelated
   direct dependencies were not upgraded.

5. If Wrangler, Workers types, or configuration behavior changed, regenerate
   bindings and compare the generated output.

```bash
npm run cf-typegen
```

6. Run `.agent/workflows/verify.md`.

7. Update design or developer documentation only when the dependency changes
   architecture, commands, supported runtimes, or contributor workflow.

8. If the update cannot be made compatible within task scope, report the exact
   failure and leave the working tree in its intentional pre-update state. Do
   not discard unrelated user changes.
