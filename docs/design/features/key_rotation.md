# API Key Rotation

Rotation spreads traffic across credential slots so one key does not consume
the provider limit alone. Explicit selection exists for authenticated
operational checks of a particular slot. Neither mechanism reveals credential
material or provides globally ordered allocation.

## Selection policies

Provider keys are normalized to arrays. Selection follows this precedence:

1. An explicit `/key/<selection>` path prefix.
2. Striped round-robin when the provider has multiple keys.
3. Index zero for zero or one key.

For automatic chat and provider pass-through selection, cooling key
slots are removed before the selected rotation phase is resolved. Explicit
selection has higher precedence than cooldown filtering.

Model aggregation is an exception: it uses the first key by default so
read-only discovery does not advance rotation. Explicit key selection applies.

## Striped isolate-local rotation

Each rotation identifier maps to an in-memory counter scoped to the Worker
isolate. Static providers use their environment variable name and profile;
custom endpoints use their configured endpoint name and profile. The default
profile uses the unsuffixed identifier. The first selection in an isolate draws
a cryptographically random starting phase; subsequent selections advance the
counter modulo the key count.

Random starting phases keep aggregate use approximately balanced across
isolates without coordination on the request path. Counters reset when an
isolate is recycled. Rotation therefore provides statistical distribution, not
global ordering or durable state.

## Error cooldowns

An attributable upstream HTTP 401, 403, 429, or 5xx response places the
selected provider key slot into an isolate-local cooldown. The duration is
configured by `API_KEY_COOLDOWN_SECONDS`, defaults to 60 seconds, is capped at
86,400 seconds, and can be disabled with `0`. A successful response clears any
cooldown for the selected slot early. HTTP 404 is not credential-attributable:
it commonly identifies an unknown model or provider path, so it passes through
without affecting key selection.

Cooldown state is keyed only by provider selector (including a named profile)
and zero-based slot; it
never stores credential values or derived credential identifiers. Like striped
rotation, it is best-effort state scoped to a warm isolate. This avoids adding
persistent cross-request storage and a coordination round trip to the request
path. Different isolates may therefore cool the same key at different times,
and recycling an isolate clears its cooldown history.

Filtering is availability-preserving. A provider with zero or one key follows
its ordinary selection. If every slot is cooling, selection ignores all
cooldowns and uses the ordinary rotation result. Explicit numeric or range
selection also bypasses cooldown filtering because caller selection has higher
precedence. AI Gateway Compatibility fallback omits cooling slots when at least
one eligible local credential is available and records each attributable
attempt separately.

## Explicit selection

A numeric selection wraps modulo the key count. A range clamps its upper bound
to the final key and chooses randomly from the inclusive range. Open bounds mean
the first or final key. Explicit selection is request-scoped and does not
advance the rotation counter.

The prefix is accepted only for OpenAI-compatible chat, Responses,
Anthropic-compatible Messages, model aggregation, and registered provider
pass-through. Routes that do not consume a selected
provider credential reject it with HTTP 400 rather than silently ignoring it.

Callers must not explicitly select keys for a provider with zero keys; modulo
resolution requires a non-empty key set. Custom endpoints without authentication
remain usable when no selection prefix is supplied.

## Operational implications

- Rotation distributes direct and provider-endpoint requests. With automatic
  selection, OpenAI-compatible Gateway chat tries the selected rotation slot
  first, then shuffled remaining keys until a request succeeds. An explicit
  index or range resolves one key and disables this fallback.
- Cooldowns affect only automatic chat, Responses, Messages, and provider pass-through selection;
  model discovery retains its first-key contract, diagnostics scan every key,
  and Universal Endpoint responses cannot be attributed to one step credential.
- Reordering the configured array changes which credential a stored numeric
  counter refers to for the remainder of each isolate's lifetime; a redeploy
  recycles isolates and restarts rotation from fresh random phases.
- Reducing the array length is safe; the next selection returns to the new
  bounds.
