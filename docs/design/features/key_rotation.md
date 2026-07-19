# API Key Rotation

## Selection policies

Provider keys are normalized to arrays. Selection follows this precedence:

1. An explicit `/key/<selection>` path prefix.
2. Striped round-robin when `ENABLE_GLOBAL_ROUND_ROBIN=true` and the provider
   has multiple keys.
3. Cryptographically secure random selection for multiple keys.
4. Index zero for zero or one key.

Model aggregation is an exception: it uses the first key by default so
read-only discovery does not advance rotation. Explicit key selection still
applies.

## Striped isolate-local rotation

Each rotation identifier maps to an in-memory counter scoped to the Worker
isolate. Static providers use their environment variable name; custom endpoints
use their configured endpoint name. The first selection in an isolate draws a
cryptographically random starting phase; subsequent selections advance the
counter modulo the key count.

Rotation exists to spread load across keys so no single key exhausts its
provider rate limit, not to guarantee a strict global ordering. Overlaying
many perfect per-isolate rotations with random phases keeps aggregate key
usage near-uniform: the per-key deviation is bounded by the number of live
isolates rather than growing with the square root of the request count, which
is tighter than pure random selection. In exchange, selection never leaves the
isolate: no request pays a cross-isolate coordination round trip on its
critical path.

`getNextIndex` reads the counter (or draws the random phase), bounds it
against the current key-array length, stores the following counter, and
returns the selected index. Counters reset when an isolate is recycled; the
fresh random phase preserves the aggregate distribution.

## Explicit selection

A numeric selection wraps modulo the key count. A range clamps its upper bound
to the final key and chooses randomly from the inclusive range. Open bounds mean
the first or final key. Explicit selection is request-scoped and does not
advance the rotation counter.

The prefix is accepted only for OpenAI-compatible chat, model aggregation, and
registered provider pass-through. Routes that do not consume a selected
provider credential reject it with HTTP 400 rather than silently ignoring it.

Callers must not explicitly select keys for a provider with zero keys; modulo
resolution requires a non-empty key set. Custom endpoints without authentication
remain usable when no selection prefix is supplied.

## Operational implications

- Rotation distributes direct and provider-endpoint requests. With automatic
  selection, OpenAI-compatible Gateway chat tries the selected rotation slot
  first, then shuffled remaining keys until a request succeeds. An explicit
  index or range resolves one key and disables this fallback.
- Reordering the configured array changes which credential a stored numeric
  counter refers to for the remainder of each isolate's lifetime; a redeploy
  recycles isolates and restarts rotation from fresh random phases.
- Reducing the array length is safe because an out-of-range stored counter is
  reset to zero on the next call.
- Strict cross-isolate ordering is intentionally not guaranteed; the
  distribution guarantee is statistical near-uniformity of aggregate key
  usage.
- Random fallback preserves availability when rotation is disabled, but it
  provides no ordering guarantee.
