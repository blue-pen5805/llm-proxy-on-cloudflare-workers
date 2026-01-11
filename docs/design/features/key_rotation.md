# Stateful Key Rotation Design

## Rationale

To ensure high availability and bypass per-key rate limits, the proxy supports distributing requests across multiple API keys for each provider. A critical design requirement is maintaining a consistent rotation state (round-robin) across globally distributed Cloudflare edge nodes.

## Design Choice: Coordinated State via Durable Objects

Simple local counters or eventual consistency stores (like KV) are insufficient for strict round-robin because different edge nodes would not see the same state instantly.

### Architecture

- **Global Single Point of Truth**: We utilize **Cloudflare Durable Objects** (`KeyRotationManager`) as the coordinator. For a given provider key name, all edge nodes communicate with the same Durable Object instance.
- **Atomic State Management**: Each Durable Object instance manages its own state transactionally.

### Persistence with SQLite

Within the Durable Object, we use the **Cloudflare Durable Objects SQL storage API** (based on SQLite) to store current indices.

- **Reliability**: SQLite ensures that index increments are atomic and durable, even if the Durable Object is evicted from memory.
- **Isolation**: Counters are tracked per `key_name`, allowing independent rotation for different providers (e.g., OpenAI vs Anthropic).

## Fallback Design: Stateless Randomization

Resilience is prioritized over strictness.

- If `GLOBAL_ROUND_ROBIN` is disabled or the Durable Object binding is missing, the system automatically falls back to **Random Selection**.
- This ensures that the proxy remains functional even if the stateful coordination layer encounters issues or is not configured for the environment.

### Centralized Provider Integration

The rotation logic is centralized in the `ProviderBase` class.

- **CustomOpenAI Support**: Unlike static providers that depend on environment-level keys, `CustomOpenAI` utilizes its specific `name` from the configuration as the unique identifier for rotation coordination. This allows each custom endpoint to have its own independent round-robin state.
- **Standardized Access**: Request handlers interact with providers via `getNextApiKeyIndex()`, which transparently handles either stateful global rotation or stateless random fallback.

### Exceptions

- **Model Listing**: The `/models` endpoint explicitly bypasses rotation and always uses the first key (index 0) to ensure deterministic responses when aggregating model lists.

## Logic Flow

1.  Identify the target provider based on the request model or path.
2.  Call `provider.getNextApiKeyIndex()` to determine which API key to use.
3.  If multiple keys exist, the provider requests the "next index" from the `KeyRotationManager` (Durable Object) using its unique identifier.
4.  The Durable Object executes a `SELECT` + `UPDATE` on its internal SQLite table to increment and return the index.
5.  The handler uses the resolved index to select the appropriate key from `provider.getApiKeys()`.

## References

- [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- [Durable Objects SQL Storage API](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
