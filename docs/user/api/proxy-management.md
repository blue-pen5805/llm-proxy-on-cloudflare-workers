# Proxy management API

The management routes expose liveness, bounded provider credential diagnostics,
and the configured virtual-model routing graph. They use normal proxy
authentication and do not accept explicit key selection. All support `HEAD` with
the corresponding `GET` status and headers and no body.

## Liveness

`GET /ping` returns `Pong`. This proves only that the Worker can route a
request. It does not validate provider configuration or credentials.

## Status

`GET /status` checks every configured credential against provider model-list
endpoints concurrently, with a five-second timeout per check and no
application-level concurrency cap, and returns `valid`, `invalid`, or `unknown`.

No key value or suffix is returned, but the response reveals configured
providers, credential slot counts, default model configuration, and AI Gateway
identifiers. Keep it authenticated and do not publish its output in support
tickets without review. The response uses compact JSON.

All proxy-generated health and diagnostic responses carry `Cache-Control:
no-store`. When `STATUS_CACHE_TTL_SECONDS` is positive, `/status` reuses an
internal per-datacenter result and reports `HIT` or `MISS` in
`X-Proxy-Status-Cache`; request `no-cache` refreshes it and `no-store` bypasses
it.

Successful HTTP responses are `valid`; HTTP 401/403 and unexpected fetch errors
are `invalid`. Timeouts, unsupported model listing, and other non-success
responses are `unknown`. Unexpected fetch errors are logged.

The check count follows the deployed credential count and can exhaust the
per-request subrequest budget. After authentication, provider and check failures
remain isolated: unexamined slots and subrequest-limit exceptions stay
`unknown`, and providers that cannot be described report `available: false` with
no key slots.

## Virtual models

`GET /virtual-models` returns configured virtual models without making provider
subrequests. Its top-level `{ "object": "list", "data": [...] }` shape and
each item's `id`, `object`, `created`, and `owned_by` fields match the
virtual-model entries returned by `GET /models`. The additional `access_order`
array contains Virtual Model-specific routing details in the same order as
`VIRTUAL_MODELS`. `position` is one-based, `retries` is the number of additional
attempts, and `attempts` is the resulting maximum number of times that candidate
can be entered before failover. `timeout_ms` appears only when a response-header
timeout is configured.

```json
{
  "object": "list",
  "data": [
    {
      "id": "virtual/reliable",
      "object": "model",
      "created": 0,
      "owned_by": "virtual",
      "access_order": [
        {
          "position": 1,
          "model": "openai/gpt-4o-mini",
          "retries": 1,
          "attempts": 2,
          "timeout_ms": 5000
        }
      ]
    }
  ]
}
```

Nested virtual-model references are expanded recursively into an `access_order`
on the referencing candidate. The reference candidate remains in the response,
so its retries and timeout still describe the boundary around the complete
nested chain. A virtual-model key shadowed by a real provider is not expanded,
matching runtime provider precedence.

An unconfigured deployment returns an empty `data` array. Invalid
`VIRTUAL_MODELS` configuration fails with the same HTTP 503 as Chat Completions
and model discovery. The route accepts `/g/<gateway>/virtual-models` without
changing the response.
