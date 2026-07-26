# Provider Credential Profiles

## Purpose and compatibility

Credential profiles let an operator maintain independent key pools for one
provider, such as free and paid accounts, without duplicating provider adapters
or upstream routing configuration. Scalar, array, and profile-map credential
forms are parallel configuration choices. A scalar or array selects the
`default` profile, while a profile map can define `default` and additional
named pools. The unqualified provider name selects `default` and uses the
`<provider>/<model>` model ID form.

Profile names are operator-controlled identifiers of 1–64 letters, digits,
`.`, `_`, `~`, or `-`. A selector is `<provider>:<profile>`; the colon is
reserved for this boundary and provider names cannot contain it.

## Request-scoped provider views

The registry resolves a selector into the provider adapter plus an immutable
credential-profile view. Adapter instances are safe to share
across concurrent requests because no mutable profile is stored on the base
instance. Credential reads made through the view select only that profile.

The selector is accepted by Chat Completions, Responses, and Messages model
IDs, provider pass-through paths, and Universal Endpoint provider fields. AI
Gateway receives the base provider name because profiles are a proxy-side
credential-selection concept. Unknown or malformed named profiles do not
silently fall back to `default`.

## Selection, discovery, and diagnostics

Each profile has its own key array. Striped rotation identifiers and cooldown
maps include the profile so traffic or failures in one pool do not affect
another. `/key/<selection>` resolves an index only within the selected pool.
Gateway-ready credentials use the same index alignment as ordinary keys
inside each profile.

Model aggregation enumerates the default provider plus every configured named
profile. Default IDs use `<provider>/<model>` while named IDs use
`<provider>:<profile>/<model>`. Status uses the same selectors and reports slot
metadata separately. Structured key-selection logs add `credential_profile`
for named profiles, without exposing credential values or derived identifiers.

Auxiliary provider settings are shared. Examples include Azure resource and
API version, Workers AI account ID, and Bedrock region. Vertex AI is the one
credential-shape exception: each profile contains a service-account object or
array rather than strings, but resolution and index alignment are identical.
