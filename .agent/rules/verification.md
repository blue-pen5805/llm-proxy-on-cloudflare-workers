---
trigger: always_on
---

# Verification Rules

Verification must match the scope of the change and must be reported in the
task handoff. Do not create repository files solely to record command output.

## Code, configuration, or dependency changes

Run the complete verification workflow in `.agent/workflows/verify.md`:

1. `npm run tsc`
2. `npm run prettier-ci`
3. `npm run lint`
4. `npm run test`

If formatting fails, run `npm run prettier`, review the diff, and repeat the
checks. A command that was not run or did not pass must be disclosed rather than
described as successful.

## Documentation-only changes

At minimum:

1. Run Prettier against the changed Markdown files.
2. Check relative links and referenced repository paths.
3. Compare commands, routes, and configuration names with their authoritative
   implementation files.
4. Run `git diff --check`.

Run broader project checks when documentation changes expose uncertainty about
the implementation or when formatting touches non-documentation files.
