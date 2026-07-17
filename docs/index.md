# Documentation

This directory is the source of truth for using, operating, and extending the
LLM proxy. Start with the setup guide, then use the task-oriented guides below.

## User guides

- [Initial setup](initial-setup.md) ([日本語](initial-setup_ja.md))
- [Configuration reference](configuration.md)
- [HTTP API and routing](api.md)
- [Operations and troubleshooting](operations.md)
- [Adversarial security review (日本語)](adversarial-review.md)

## Contributor guides

- [Development and verification](development.md)
- [Architecture and design](design/overview.md)

## Documentation conventions

- Commands are run from the repository root unless a guide says otherwise.
- Example credentials are placeholders. Never commit `config.jsonc`,
  `config.<environment>.jsonc`, or `.dev.vars*` files.
- Configuration behavior is defined by
  [`schemas/config-schema.json`](../schemas/config-schema.json),
  [`config.example.jsonc`](../config.example.jsonc), and the implementation in
  `src/utils/config.ts`.
- Design documents are written in English and explain architectural decisions.
