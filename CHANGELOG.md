# Changelog

Changes to application functionality and externally observable runtime behavior
are documented in this file. Date entries in `YYYY-MM-DD` format and order them
in reverse chronological order. Add new entries at the top of the relevant
dated section; when multiple changes share a date, put the newest change first.

## Unreleased

Planned version: `1.0.0`. The package remains at `0.2.1` until the version
update is explicitly approved.

### 2026-07-18

- Added the `nvidia-nim` provider for NVIDIA's hosted OpenAI-compatible Chat
  Completions, model discovery, and pass-through API with configurable key
  rotation.
- Fixed strict AI Gateway routing for Ollama to preserve the `/v1` prefix in
  chat, model, and pass-through request paths.
- Fixed strict AI Gateway pass-through to authenticate Google AI Studio's
  OpenAI-compatible paths with the required Bearer credential.
- Added strict `ALWAYS_USE_AI_GATEWAY` routing with `default` Gateway fallback
  and deployment-time Custom Provider synchronization for provider operations
  that lack native AI Gateway routes.
- Fixed provider request header merging so case variants such as `Content-Type`
  and `content-type` produce one upstream field.
