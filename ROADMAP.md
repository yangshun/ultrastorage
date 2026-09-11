# Roadmap

Planned additions to ultrastorage. These are feature directions, not finalized API
names or release commitments. Current behavior is documented in [the API reference](docs/reference/storage.md),
with design explanations in [how it works](docs/resources/how-it-works.md).

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
