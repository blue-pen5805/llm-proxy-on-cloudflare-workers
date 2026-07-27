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

`VIRTUAL_MODELS` maps a virtual model name to an ordered
candidate array. `"virtual/<name>"` is the recommended convention, but the key
may be any safe identifier matching `[A-Za-z0-9._~/-]{1,128}`; it is compared
verbatim against the requested `model`. A candidate is either a bare
`"<provider>/<model>"` string,
which is attempted once, or an object with `model` and optional `retries` and
`timeout` settings. `retries` is the number of additional attempts against that
candidate after its first retryable failure, defaults to `0`, and is limited to
`5`. `timeout` is measured in milliseconds and limits the wait for response
headers to an integer from `1` through `300000`; omitting it leaves that wait
unbounded except for client cancellation and platform limits.

Virtual-model lookup uses only configured keys; `__proto__` is stored and
listed as an ordinary model name. See
[Security Design Decisions](../security-decisions.md).

Real providers take precedence over virtual model keys, so a key never shadows a
built-in provider or a `CUSTOM_OPENAI_ENDPOINTS` name: a request resolves as a
virtual model only when its `model` does not name a real provider. The `virtual`
prefix is convenient precisely because no real provider is named `virtual`, but a
key that does collide with a real provider (for example `"openai/gpt-4o-mini"`)
is simply never reached rather than overriding it. At most 100 virtual models are
accepted, each with 1 to 16 candidates. A candidate may name another configured
virtual model, including keys outside the recommended `virtual/` namespace.
References are followed only when the candidate does not resolve as a real
provider, so provider precedence applies at every level.

The resulting reference graph must be acyclic. `npm run secrets:deploy`,
including `--dry-run`, checks the graph before invoking Wrangler and rejects
direct and indirect cycles. Runtime validation repeats the check for
configuration installed outside that helper. Validation also computes the
worst-case number of concrete provider attempts after references and retries
are expanded. Every virtual model is limited to 96 concrete attempts.

Configuration remains trusted operator input, matching `CUSTOM_OPENAI_ENDPOINTS`:
schema and runtime validation reject malformed names, empty or oversized
candidate lists, malformed candidate definitions, unknown object properties,
and retry or timeout values outside their supported ranges. Invalid runtime
configuration is not treated as an empty map; after proxy authentication,
requests fail with a safe HTTP 503 configuration error that does not echo the
rejected value (`src/utils/config.ts`, `Config.virtualModels()`).

## Resolution and routing

Model resolution in `handleChatCompletionsRequest`
(`src/requests/chat_completions.ts`) first splits the request model on `/` and
tries to resolve the leading segment as a real provider. Only when that fails
does it consult the virtual model map, so real providers always win. A matching
virtual model looks up its candidate list; a model that names neither a real
provider nor a configured virtual model returns the same HTTP 400
`"Invalid provider."` response as an unknown provider, so a typo in a virtual
model name is indistinguishable from a typo in a provider name.

Each candidate is resolved recursively. A candidate that names another virtual
model runs that model's ordered chain; otherwise it uses the single-model path
(`attemptChatCompletion`) for a plain `"<provider>/<model>"` request. The same
provider resolution, AI Gateway routing decision, header sanitization, and
per-provider key rotation apply. Without an explicit key path,
each candidate attempt selects a configured key using striped per-isolate
round-robin. An explicit `/key/<index>/...` selection
uses that index for every attempt (modulo each provider's key count), while an
explicit range is resolved randomly within that range for every attempt. Both
forms override the automatic rotation policy. A virtual model is therefore
never a way to bypass a provider's own configuration or credential requirements
— a misconfigured candidate fails exactly as it would if requested directly.

## Model discovery

`handleModelsRequest` (`src/requests/models.ts`) seeds the aggregated list with
the configured virtual models before the provider fan-out, so each is emitted at
the front of `data` as `{ id: "<key>", object: "model", created: 0, owned_by:
"virtual" }` ahead of the provider-discovered entries. They are bounded (at most
`MAX_VIRTUAL_MODELS`) and only count against the aggregate byte budget rather
than being subject to provider truncation, so a configured virtual model is
always advertised. Discovery reuses the same `Config.virtualModels()` accessor as
routing, so a malformed `VIRTUAL_MODELS` fails `/models` closed with the same
HTTP 503 as a chat request rather than silently dropping the entries.

The authenticated `GET /virtual-models` route provides the configuration view
that the OpenAI-compatible model list intentionally omits. Its list envelope and
the standard `id`, `object`, `created`, and `owned_by` fields on each item match
the virtual-model entries in `/models`; `access_order` is an additive extension
containing the normalized candidate array. Candidate entries expose the model,
one-based position, additional retry count, total attempts for that candidate,
and the response-header timeout when one was configured. It makes no provider
subrequests and returns an empty list when the setting is absent. Nested
references are expanded recursively as an
`access_order` on the referencing candidate. The reference candidate remains as
the parent node so its retry and timeout settings continue to describe the
boundary at which the complete referenced chain is restarted. References whose
leading selector resolves to a real provider are not expanded, matching the
provider precedence used by chat routing. Runtime configuration validation
guarantees that this bounded recursive rendering receives an acyclic graph.

Like `/status`, this route passes through normal proxy authentication and
rejects `/key/<selection>` because it performs no credential selection. A
Gateway prefix is accepted by the shared path middleware, but Gateway selection
does not change the response. The route uses `Config.virtualModels()`, so
malformed configuration fails closed with the standard HTTP 503 configuration
error.

## Retry policy

`runVirtualModelChainAttempt` (`src/requests/virtual_model.ts`) tries candidates
in order. For an object candidate it retries the same model up to its configured
`retries` count before moving on. For a virtual-model reference, one attempt is
one complete execution of the referenced chain, so a retry restarts that chain.
It stops at the first outcome that is not
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

For a virtual-model reference, `timeout` becomes the default response-header
timeout for concrete attempts below that reference. A more specific timeout on
a nested candidate overrides the inherited value. The timeout controller is
cleared as soon as the upstream fetch returns
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

Resolution issues a fresh upstream request per candidate. A candidate that
fails after partially executing a
non-idempotent upstream side effect (for example, a provider that bills or logs
on receipt rather than on completion) may still incur that cost even though its
response is discarded. Per-credential retries and virtual-model retries share
this risk.

## Observability

Each candidate attempt emits `virtual_model.select` when its candidate is
selected, before provider credential selection or upstream I/O. An attempt
followed by another emits `virtual_model.retry`; the final HTTP result or final
thrown error emits `virtual_model.completed`. These events report the virtual
model name, candidate model, attempt index, configured timeout in milliseconds,
and response status or safe error fields when available. No request or response
body is logged.

The successful candidate's concrete provider, model, credential slot, and
Gateway route are also returned in the optional Chat Completions `llm_proxy`
extension. The client-requested virtual model remains visible as
`requested_model`. When the request uses AI Gateway, that same outer
client-requested name is added to `cf-aig-metadata` as
`llm_proxy_virtual_model`, including when candidate resolution traverses nested
virtual models. The concrete candidate's credential profile and provider key
slot are included in the scalar `llm_proxy_credentials` tag as
`<credential-profile>:<provider-key-index>`. Client metadata retains precedence
on key collisions. Failed candidate history remains log-only. See
[OpenAI-compatible response metadata](chat-response-metadata.md).

## References

- [Custom OpenAI-compatible endpoints](custom-openai-endpoints.md) — the
  configuration-validation pattern this feature follows.
- [Project principles](../../project-principles.md)
