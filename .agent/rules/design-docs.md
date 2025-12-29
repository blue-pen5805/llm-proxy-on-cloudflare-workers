---
trigger: always_on
---

# Design Documentation Rules

Whenever implementing a new feature or modifying an existing one, the AI Agent MUST ensure that the corresponding design documentation is either created or updated.

## Mandatory Actions

1.  **Analyze Impact**: Identify which features or architectural components are affected by the change.
2.  **Update Design Docs**:
    *   If the change introduces a new core capability, create a new document in `docs/design/features/`.
    *   If the change modifies existing behavior, update the relevant file in `docs/design/features/`.
    *   Ensure any new document is linked correctly from `docs/design/overview.md` using **relative paths**.
3.  **Maintain Design Rationale**: Focus on the *why* and *how* (structural design) rather than just implementation details.
4.  **Reference External Docs**: Append official documentation URLs (e.g., Cloudflare, LLM providers) to the `References` section if the change involves external integrations.
5.  **Language Consistency**: All design documentation MUST be written in **English**.

## Verification
Before completing a task, verify that the design documentation accurately reflects the final implementation.
