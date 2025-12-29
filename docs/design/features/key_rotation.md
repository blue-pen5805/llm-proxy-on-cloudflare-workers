# Stateful Key Rotation Design

## Rationale
To ensure high availability and bypass per-key rate limits, the proxy supports distributing requests across multiple API keys for each provider. A critical design requirement is maintaining a consistent rotation state (round-robin) across globally distributed Cloudflare edge nodes.

## Design Choice: Coordinated State via Durable Objects
Simple local counters or eventual consistency stores (like KV) are insufficient for strict round-robin because different edge nodes would not see the same state instantly.

### Architecture
*   **Global Single Point of Truth**: We utilize **Cloudflare Durable Objects** (`KeyRotationManager`) as the coordinator. For a given provider key name, all edge nodes communicate with the same Durable Object instance.
*   **Atomic State Management**: Each Durable Object instance manages its own state transactionally.

### Persistence with SQLite
Within the Durable Object, we use the **Cloudflare Durable Objects SQL storage API** (based on SQLite) to store current indices. 
*   **Reliability**: SQLite ensures that index increments are atomic and durable, even if the Durable Object is evicted from memory.
*   **Isolation**: Counters are tracked per `key_name`, allowing independent rotation for different providers (e.g., OpenAI vs Anthropic).

## Fallback Design: Stateless Randomization
Resilience is prioritized over strictness.
*   If `GLOBAL_ROUND_ROBIN` is disabled or the Durable Object binding is missing, the system automatically falls back to **Random Selection**.
*   This ensures that the proxy remains functional even if the stateful coordination layer encounters issues or is not configured for the environment.

## Logic Flow
1.  Check for multiple keys in the `{PROVIDER}_API_KEY` environment variable.
2.  If multiple keys exist, request the "next index" from the `KeyRotationManager` (Durable Object).
3.  The Durable Object executes a `SELECT` + `UPDATE` on its internal SQLite table to increment and return the index.
4.  The handler uses the returned index to select the appropriate key for the upstream request.

## References
*   [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
*   [Durable Objects SQL Storage API](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
