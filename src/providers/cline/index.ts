export { Cline } from "./provider";

/*
Cline uses OpenAI-compatible JSON and Bearer authentication. Operators provide
the signed-in account token as CLINE_API_KEY; this proxy does not create,
refresh, or exchange it.

Base URL: https://api.cline.bot/api/v1
Chat Completions: /chat/completions
Models: /ai/cline/recommended-models

The model response groups entries under `recommended`, `free`, and `clinePass`.
The adapter flattens all three groups and retains each group name, display name,
description, and tags as provider metadata. Model access and billing remain
subject to the authenticated Cline account.

Cline is not a native Cloudflare AI Gateway provider. Strict Gateway mode uses
the managed Custom Provider route.

Non-streaming Chat Completions responses are wrapped as
`{ data: <OpenAI response>, success: true }`; the compatibility adapter unwraps
`data`. Streaming responses already use ordinary OpenAI-compatible SSE chunks
and remain byte-for-byte streamed without parsing or rewriting.

References:
- https://docs.cline.bot/getting-started/cline-provider
- https://github.com/cline/cline/blob/main/sdk/packages/llms/src/providers/builtins.ts
- https://github.com/cline/cline/blob/main/sdk/packages/llms/src/catalog/catalog-cline-recommended.ts
*/
