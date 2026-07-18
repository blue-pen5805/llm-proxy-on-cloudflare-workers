# API Key Rotation

## Selection policies

Provider keys are normalized to arrays. Selection follows this precedence:

1. An explicit `/key/<selection>` path prefix.
2. Coordinated round-robin when `ENABLE_GLOBAL_ROUND_ROBIN=true`, the provider
   has multiple keys, and the `KEY_ROTATION_MANAGER` binding is available.
3. Cryptographically secure random selection for multiple keys.
4. Index zero for zero or one key.

Model aggregation is an exception: it uses the first key by default so
read-only discovery does not advance rotation. Explicit key selection still
applies.

## Durable Object coordination

Each rotation identifier maps through `idFromName` to one Durable Object. Static
providers use their environment variable name; custom endpoints use their
configured endpoint name. The object stores a counter per identifier in a
SQLite-backed `counters` table.

`getNextIndex` reads the current counter, bounds it against the current key-array
length, writes the following counter, and returns the selected index. Durable
Object single-threaded execution plus SQLite persistence coordinates requests
that arrive at different Worker isolates.

The `wrangler.jsonc` binding and `new_sqlite_classes` migration are part of this
design. Removing or renaming either requires an explicit migration plan.

## Explicit selection

A numeric selection wraps modulo the key count. A range clamps its upper bound
to the final key and chooses randomly from the inclusive range. Open bounds mean
the first or final key. Explicit selection is request-scoped and does not change
the Durable Object counter.

Callers must not explicitly select keys for a provider with zero keys; modulo
resolution requires a non-empty key set. Custom endpoints without authentication
remain usable when no selection prefix is supplied.

## Operational implications

- Rotation distributes direct and provider-endpoint requests. With automatic
  selection, OpenAI-compatible Gateway chat requests additionally try the
  shuffled configured keys in order until a request succeeds. An explicit
  index or range resolves one key and disables this fallback.
- Reordering the configured array changes which credential a stored numeric
  counter refers to.
- Reducing the array length is safe because an out-of-range stored counter is
  reset to zero on the next call.
- Random fallback preserves availability when coordinated rotation is disabled,
  but it provides no ordering guarantee.

## References

- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
