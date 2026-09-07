# Documentation

- `user/`: setup, configuration, operations, and API references.
- `developer/`: contribution guides, verification, principles, and design.

## Application users and operators

Use an existing deployment through the API guides. To host your own proxy, start
with initial setup, then use configuration and operations.

- [HTTP API and routing](user/api/overview.md)
  - [OpenAI-compatible API](user/api/openai-compatible.md)
  - [Anthropic-compatible API](user/api/anthropic-compatible.md)
  - [Provider pass-through API](user/api/provider-pass-through.md)
  - [AI Gateway API](user/api/ai-gateway.md)
  - [Proxy management API](user/api/proxy-management.md)
- [Initial setup](user/initial-setup.md) ([日本語](user/initial-setup_ja.md))
- [Configuration reference](user/configuration.md)
- [Operations and troubleshooting](user/operations.md)

## Developers

For changes to the proxy's implementation, tests, or configuration definitions.

- [Development and verification](developer/development.md)
- [Live provider Chat Completions testing](developer/live-provider-testing.md)
- [Project principles](developer/project-principles.md)
- [Architecture and design](developer/design/overview.md)
- [Repository instructions for coding agents](../AGENTS.md)

Commands run from the repository root unless stated otherwise. Example
credentials are placeholders; keep files containing real values private.
