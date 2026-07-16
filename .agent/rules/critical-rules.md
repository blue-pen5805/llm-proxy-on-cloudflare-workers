---
trigger: always_on
---

# Critical Agent Rules

This document defines the most important rules for AI Agents working on this project. These rules MUST be followed strictly at all times to ensure project integrity and security.

## 1. Absolute Protection of Configuration

1. **NEVER edit `config.jsonc` or `config.<env>.jsonc`**: These files contain local-specific configuration and potential secrets managed by the human developer.
2. **Use `config.example.jsonc`**: If new configuration parameters are introduced, add safe placeholders to `config.example.jsonc` instead of a local configuration file.

## 2. Environment Variables & Secrets

1. **NO Real Secrets**: Never include real API keys, passwords, or sensitive credentials in code, documentation, logs, tool output shared with the user, or commit messages.
2. **Follow the Workflow**: If a new environment variable is required, use `.agent/workflows/add-env-var.md` and ask the user to add any real value themselves.
3. **Protect Generated Files**: Treat `.dev.vars*`, `.secrets-temp.json`, and secret-deployment dry-run output as sensitive.

## 3. Schema and Type Synchronization

1. **Run `cf-typegen`**: Whenever you modify `schemas/config-schema.json`, you MUST run `npm run cf-typegen` to update `worker-configuration.d.ts`.
2. **NO Direct Edit of Typegen Files**: Never manually edit `worker-configuration.d.ts` or other automatically generated files. They will be overwritten during the next generation.

## 4. Code Quality and Verification

1. **Run Verification**: After code, configuration, or dependency changes, run `.agent/workflows/verify.md`. For documentation-only work, follow `.agent/rules/verification.md`.
2. **No Placeholders**: Never leave `TODO` comments or placeholder implementations in final code unless explicitly requested by the user.
