# Security & Configuration Design

## Authentication Framework

The proxy implements a **Shared Secret Authentication** model via API keys.

### Request Validation

- **Headers**: Supports `Authorization: Bearer ...`, `x-api-key`, and `x-goog-api-key`.
- **Query Parameters**: Supports `?key=...`.
- **Multi-Key Support**: `PROXY_API_KEY` can be an array of keys.
- **Timing-Safe Comparison**: Candidate and configured keys are hashed to a fixed length and compared without an early return, reducing timing side channels without changing supported authentication formats.
- **Credential Isolation**: Headers accepted for proxy authentication are removed before forwarding. Provider credentials are added separately, preventing proxy secrets from leaking to upstream APIs.
- **Error Redaction**: Expected application errors retain their public messages, while unexpected failures return a generic message and keep diagnostic details in Worker logs.

## Configuration Principles: Environment as Single Source of Truth

Consistent with the **Twelve-Factor App** principles, the proxy is configured entirely through environment variables.

### Key Management Design

- **Static Secret Injection**: Used for `PROXY_API_KEY` and upstream provider keys.
- **Feature Toggling**: Flags like `ENABLE_GLOBAL_ROUND_ROBIN`.
- **Defaults**: `DEFAULT_MODEL` for "zero-config" experience.

## Architectural Safety

- **Pre-Routing Checks**: Authentication is performed early in the pipeline.
- **Path Isolation**: Pathname cleaning prevents path traversal or injection attacks.

## References

- [Cloudflare Workers Configuration](https://developers.cloudflare.com/workers/configuration/)
- [Environment Variables in Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/environment-variables/)
