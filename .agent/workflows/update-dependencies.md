---
description: Update project dependencies incrementally and safely
---

// turbo-all

1. Check for available updates using `npm-check-updates` (ncu).

```bash
npx ncu
```

2. Choose a specific dependency to update. Update `package.json` for that dependency only.
   Replace `PACKAGE_NAME` with the actual package name.

```bash
npx ncu -u PACKAGE_NAME
```

3. Install the updated package.

```bash
npm install
```

4. Regenerate Cloudflare Worker types to ensure compatibility.

```bash
npm run cf-typegen
```

5. Verify the changes using the `/verify` workflow (prettier, lint, tests).
   Ensure that no existing code changes are required.

```bash
/verify
```

6. If any step fails, or if the update requires significant code changes, revert the changes in `package.json` and `package-lock.json`.

> [!IMPORTANT]
> Always update dependencies one by one (or in small related groups) to isolate potential issues.
> The goal is to keep dependencies up-to-date without breaking existing functionality or requiring immediate code refactoring.
