# Cloudflare AI Gateway Integration Design

## Strategic Integration

The proxy is designed to work in synergy with **Cloudflare AI Gateway**. This integration allows users to gain features like caching, rate limiting, and detailed logging without adding complex logic to the proxy itself.

## Architectural Mechanism: Dynamic Proxying

The proxy implements a **Transparent Gateway Bridge**.

### Path Detection

When a request path begins with `/g/{gateway_name}/`, the `aiGatewayMiddleware` identifies this as a request that should be proxied through the AI Gateway.

### Dynamic URL Transformation

The proxy dynamically rewrites the destination URL to point to the AI Gateway endpoint:

- **Standard Target**: `https://api.openai.com/v1/...`
- **Gateway Target**: `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/openai/...`

## Universal Endpoint Support

The proxy provides a dedicated path to utilize the AI Gateway's **Universal Endpoint**, allowing users to leverage the gateway's provider-agnostic routing capabilities.

## References

- [Cloudflare AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [AI Gateway Universal Endpoint](https://developers.cloudflare.com/ai-gateway/providers/universal/)
