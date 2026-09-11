# Roadmap

Planned additions to ultrastorage. These are feature directions, not finalized API
names or release commitments. Current behavior is documented in [the API reference](docs/reference/storage.md),
with design explanations in [how it works](docs/resources/how-it-works.md).

## Onboard existing values by legacy key

- [ ] Import an existing value not written by ultrastorage by specifying its legacy key name.

Useful when adopting ultrastorage in an application that already saves values directly through
`localStorage`, such as importing `localStorage.getItem('theme')` into a namespaced ultrastorage
entry. Define how the legacy key is resolved, how plain strings and JSON are decoded and validated,
and when importing is attempted. Specify precedence when the destination already exists and
whether the legacy entry is retained or removed after a successful write. Failed imports must
preserve the legacy value.

## Expiration controls

- [ ] Inspect an entry's expiration time and remaining TTL.
- [ ] Change or extend expiration without requiring callers to read and rewrite the value.
- [ ] Explicitly preserve the existing expiration when updating a value.

Useful for extending a draft's lifetime or updating cached data without accidentally
removing its TTL. Define results for missing, expired, and non-expiring entries, and
how metadata changes notify subscribers. Keep existing write defaults compatible.

## Namespace subscriptions

- [ ] Observe changes to any key within a storage instance's namespace, including newly added keys.

Useful for saved-draft lists, cart summaries, and storage inspectors whose keys are
not known in advance. Follow existing namespace matching and same-page/cross-tab
boundaries. Define event behavior for bulk clears and native storage clears, array-key
representation, and listener cleanup.

## Detailed read results

- [ ] Add an optional read API that distinguishes successful values (including stored
      `null`), missing entries, expiration, foreign or unsupported data, parse failures,
      and schema validation failures.

Useful for debugging and choosing whether to initialize, recover, or discard data.
Keep `getItem()` unchanged. Define a discriminated result type, expiration cleanup
behavior, and which operational errors still throw; do not silently hide backend failures.

## Opt-in reactive expiration

- [ ] Notify subscribed consumers when an entry expires without requiring another read or cleanup.
- [ ] Update React hook values when their subscribed entries expire.

Useful for temporary notices and cached UI state. Keep lazy expiration as the default.
Define timer ownership and cleanup, rescheduling after writes or cross-tab changes,
interaction with namespace subscriptions, and whether expiry notifications also remove
stored data. Recheck timestamps after delayed timers or tab suspension; browser timers
cannot guarantee notification at the exact expiration time. Preserve SSR safety.
