# Monitoring & Diagnostics Design

## Objectives

Transparency and health monitoring are critical for a proxy handling production LLM traffic. The system includes a built-in diagnostic interface to audit configuration and verify provider availability.

## Endpoint Design: `/status`

The `/status` endpoint is designed as a **Diagnostic Dashboard** for the proxy's internal state.

### Key Validation Logic

The status system performs **Active Key Validation**:

1.  It iterates through configured providers and their API keys.
2.  For each key, it performs a minimal request (e.g., `List Models`) to the upstream provider.
3.  The result determines the key's state: `valid`, `invalid`, or `unknown`.

## Design Rationale: Security vs. Utility

- **Obfuscation**: API keys are masked to show only the identifying tail (e.g., `...abc`).
- **Authentication**: The diagnostic endpoint is protected by the same security layer as the LLM proxying endpoints.

## References

- [Cloudflare Workers Observability](https://developers.cloudflare.com/workers/observability/)
