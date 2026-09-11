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

## Opt-in reactive expiration

- [x] Notify subscribed consumers when an entry expires without requiring another read or cleanup.
- [x] Update React hook values when their subscribed entries expire.

Available through `{ reactiveExpiration: true }` on key subscriptions and React hooks.
Lazy expiration remains the default. Subscription-owned timers recheck deadlines and notify
without deleting entries; browser throttling can delay delivery. See
[reactive expiration](docs/guides/expiration.mdx#reactive-expiration).
Namespace subscription behavior remains part of the separate namespace subscriptions feature.
