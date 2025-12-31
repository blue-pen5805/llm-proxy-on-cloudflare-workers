---
trigger: always_on
---

# Critical Agent Rules

This document defines the most important rules for AI Agents working on this project. These rules MUST be followed strictly at all times to ensure project integrity and security.

## 1. Absolute Protection of Configuration

1.  **NEVER edit `config.jsonc`**: Under no circumstances should the AI Agent modify the `config.jsonc` file. This file contains local-specific configurations and potential secrets managed by the human developer.
2.  **Use `config.example.jsonc`**: If new configuration parameters are introduced, add them as placeholders to `config.example.jsonc` instead of `config.jsonc`.

## 2. Environment Variables & Secrets

1.  **NO Real Secrets**: Never include real API keys, passwords, or any sensitive credentials in code, documentation, or commit messages.
2.  **Request Addition**: If a new environment variable is required, use the `@/add-env-var` workflow to prompt the user to add it.

## 3. Schema and Type Synchronization

1.  **Run `cf-typegen`**: Whenever you modify `schemas/config-schema.json`, you MUST run `npm run cf-typegen` to update `worker-configuration.d.ts`.
2.  **NO Direct Edit of Typegen Files**: Never manually edit `worker-configuration.d.ts` or other automatically generated files. They will be overwritten during the next generation.

## 4. Code Quality and Verification

1.  **Run Verification**: After any code changes, always run the `@/verify` workflow to ensure that the project still builds, lints, and passes all tests.
2.  **No Placeholders**: Never leave `TODO` comments or placeholder implementations in the final code unless explicitly requested by the user.
