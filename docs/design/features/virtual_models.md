# Virtual Models

## Motivation

Operators sometimes want a chat request to keep working when one provider is
rate-limited, misconfigured, or briefly unavailable, without the client having
to know or choose among specific alternates. [Project
principles](../../project-principles.md) require this kind of behavior to be
explicit in operator configuration, bounded, and observable rather than an
implicit provider substitution, so the behavior is modeled as a named,
operator-defined virtual model rather than automatic cross-provider retry.

## Configuration model

`VIRTUAL_MODELS` maps a reserved `"virtual/<name>"` model name to an ordered
candidate array. A candidate is either a bare `"<provider>/<model>"` string,
which is attempted once, or an object with `model` and optional `retries` and
`timeout` settings. `retries` is the number of additional attempts against that
candidate after its first retryable failure, defaults to `0`, and is limited to
`5`. `timeout` is measured in milliseconds and limits the wait for response
headers to an integer from `1` through `300000`; omitting it leaves that wait
unbounded except for client cancellation and platform limits.

The `virtual` segment is a pseudo-provider namespace: it never resolves through
the provider registry, so it cannot collide with a built-in provider or a
`CUSTOM_OPENAI_ENDPOINTS` name. At most 100 virtual models are accepted, each
with 1 to 16 candidates. A candidate cannot itself name the `virtual` namespace,
so a virtual model can never chain into another virtual model — resolution is
always one flat lookup followed by a bounded, linear sequence of at most 96
candidate attempts.

Configuration remains trusted operator input, matching `CUSTOM_OPENAI_ENDPOINTS`:
schema and runtime validation reject malformed names, empty or oversized
candidate lists, malformed candidate definitions, unknown object properties,
and retry or timeout values outside their supported ranges. Invalid runtime
configuration is not treated as an empty map; after proxy authentication,
requests fail with a safe HTTP 503 configuration error that does not echo the
rejected value (`src/utils/config.ts`, `Config.virtualModels()`).

## Resolution and routing

Model resolution in `handleChatCompletionsRequest`
(`src/requests/chat_completions.ts`) checks for the `virtual/` prefix before
splitting the request model into a provider and model name. A matching virtual
model looks up its candidate list; an undefined virtual model name returns the
same HTTP 400 `"Invalid provider."` response as an unknown provider, so a typo
in a virtual model name is indistinguishable from a typo in a provider name.

Each candidate is resolved and executed through the existing single-model path
(`attemptChatCompletion`), unchanged from a plain `"<provider>/<model>"`
request: the same provider resolution, AI Gateway routing decision, header
sanitization, and per-provider key rotation apply. Without an explicit key path,
each candidate attempt selects a configured key using striped per-isolate
round-robin. An explicit `/key/<index>/...` selection
uses that index for every attempt (modulo each provider's key count), while an
explicit range is resolved randomly within that range for every attempt. Both
forms override the automatic rotation policy. A virtual model is therefore
never a way to bypass a provider's own configuration or credential requirements
— a misconfigured candidate fails exactly as it would if requested directly.

## Retry policy

`runVirtualModelChain` (`src/requests/virtual_model.ts`) tries candidates in
order. For an object candidate it retries the same model up to its configured
`retries` count before moving on. It stops at the first outcome that is not
retryable, or once the final attempt of the last candidate has run. An outcome
is retryable when:

- the response status is 401, 403, 429, or any 5xx (`isRetryableCandidateStatus`);
- provider resolution or provider configuration validation fails locally
  (an unknown or misconfigured candidate provider); or
- the attempt throws (a network error, configured timeout, or aborted fetch).

Any other response — including an ordinary 4xx such as a malformed request or
an unrecognized model at the upstream — is returned immediately. Retrying an
unchanged request body against a different model would not fix a client error,
and silently masking it behind a later, unrelated failure would make the
proxy's behavior harder to reason about.

Because the decision to advance is made from the response status alone, before
any response body is read by the caller, a switch only ever happens before the
first byte would reach the client — matching the constraint that a streamed
response cannot be safely retried mid-stream. Every losing attempt's response
body is cancelled rather than read or returned, the same discipline
`fetchCompatibilityFallback` (`src/requests/compatibility_fallback.ts`) already
applies to per-credential retries within one provider.

The timeout controller is cleared as soon as the upstream fetch returns
response headers. It therefore bounds a stalled initial response without
aborting a valid streaming body after headers have arrived. The original client
request signal is combined with the timeout signal, so client cancellation
continues to cancel the upstream fetch.

## Compatibility across candidates

Every candidate receives the same parsed request body and independently runs
that candidate provider's own `filterSupportedChatParameters`, exactly as a
direct `"<provider>/<model>"` request would. Candidates are not required to
support the same parameter set: a field silently dropped by one candidate and
honored by another is a normal consequence of choosing providers with
different capabilities, not something virtual models introduce. Operators
composing a virtual model are responsible for choosing candidates whose
accepted parameters, streaming behavior, and response shape are similar enough
for its purpose; the proxy enforces only that each candidate is independently
valid, not that candidates are equivalent to one another.

## Non-idempotent requests

Resolution issues a fresh upstream request per candidate. As with
per-credential retry, a candidate that fails after partially executing a
non-idempotent upstream side effect (for example, a provider that bills or logs
on receipt rather than on completion) may still incur that cost even though its
response is discarded. This mirrors the existing accepted risk in
per-credential retry and is not specific to virtual models.

## Observability

Each candidate attempt and the final selection are logged with the virtual
model name, candidate model, attempt index, configured timeout in milliseconds,
and (when available) the response status (`virtual_model.selected`,
`virtual_model.retry`). No request or response body is logged.

## References

- [Custom OpenAI-compatible endpoints](custom-openai-endpoints.md) — the
  configuration-validation pattern this feature follows.
- [Project principles](../../project-principles.md)
