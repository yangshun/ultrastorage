# Changelog

All notable changes to this project will be documented in this file.

## 0.7.0 - 2026-09-11

- Added array storage keys through the exported `StorageKey` type across storage methods, subscriptions, and React hooks. Equivalent arrays address the same entry without depending on array identity.
- Added `keys()` to enumerate non-expired keys in one scan. Both `key()` and `keys()` restore array keys as fresh arrays of their original string segments.
- Added development warnings when a namespace prefix contains its separator, indicating possible overlap with broader namespaces.
- Fixed package imports in browser environments without a global `process`, with smoke checks for both ESM and CommonJS builds.
- Hardened stored-entry validation and rejected non-finite expiration timestamps, including invalid dates and overflowing TTLs.
- Fixed Standard Schema handling for successful results with `issues: undefined` and asynchronous validators returning promises or thenables. Unsupported asynchronous validation now consumes rejections before throwing a synchronous error.
- Improved in-memory key enumeration by caching ordered keys until insertions or deletions change them.
- Expanded documentation for React usage, namespace overlap, storage durability, migration, and synchronous helper behavior.

### Upgrade notes

- `key()` now returns `StorageKey | null` instead of `string | null`. Update callers that assume every enumerated key is a string. `UltraStorage` no longer intersects the native `Storage` type; use `UltraStorage` for application instances.
- Existing string keys and `__us`/`__gs` entries remain supported. Avoid authoring string keys beginning with the reserved array-key prefix `\u0000us:a:`; canonical encoded strings address the same entries as their corresponding arrays.
- Subscription events retain a string `change.key`; array keys use their opaque serialized form.
- Invalid or non-finite `ttl` and `expiresAt` values now throw `TypeError`. Stored envelopes must have a value, version `1`, and an expiry of `null` or a finite number to be recognized.

## 0.6.0 - 2026-09-10

- Renamed the package from `greatstorage` to `ultrastorage` and the exported `GreatStorage` type to `UltraStorage`.
- Added key-level subscriptions through `subscribe(key, listener)`, including same-page updates across instances sharing a backend and native cross-tab storage events.
- Made the `UltraStorage` interface a strict superset of the native `Storage` interface.

- New entries use the internal storage marker `__us`. Existing `__gs` entries remain supported without migration.
- Added optional React 18/19 bindings through `ultrastorage/react`: `useStorage` and `createStorageHook`, with typed fallbacks, schema reads, functional updates, and expiration options.
- Added cached, side-effect-free internal snapshots and SSR/hydration support. Core reads retain their existing fresh-object and lazy-cleanup behavior.
- Deferred default `localStorage` access until the first operation, making instance construction safe on the server. Backend failures now occur on use rather than construction; no memory fallback is introduced.
- Added adapter rendering, hydration, subscription, failure, and type coverage. `vp run test:coverage` enforces 100% runtime coverage.
- Added documentation at https://ultrastorage.dev.

### Upgrade notes

- Replace the `greatstorage` dependency and import paths with `ultrastorage`, including `greatstorage/core` with `ultrastorage/core`. Rename type imports from `GreatStorage` to `UltraStorage`.
- Existing `__gs` entries remain readable. Older versions cannot read newly written `__us` entries, so update applications that share the same storage together.
- React remains optional. Install React 18 or 19 only when using `ultrastorage/react`.
- Default storage is resolved on first use, so constructing an instance on the server is safe; operations still require an available storage backend.

## 0.5.0 - 2026-03-10

`ultrastorage` 0.5.0 focuses on better bundle control for custom serializers and safer development ergonomics.

### Highlights

- Added a new `ultrastorage/core` entry point for applications that provide their own serializer and want to avoid bundling `devalue`.
- Added development-only warnings for two easy-to-miss cases:
  - writing `null`, which reads back the same as a missing key via `getItem()`
  - writing values with an expiry that is already in the past
- Expanded test coverage for the new core entry point and the warning behavior.
- Improved the README to document the new entry point and clarify the public API.

### Why `ultrastorage/core` exists

The default `ultrastorage` entry point still includes `devalue` so rich JavaScript values work out of the box. If you already use a custom serializer such as `superjson`, `ultrastorage/core` lets you keep the same storage API while making the serializer explicit and avoiding the extra default serialization dependency in your bundle.

### Upgrade notes

- No breaking changes in the default `ultrastorage` entry point.
- `ultrastorage/core` is new in this release. Its `createStorage()` requires a `serializer`.
- The new warnings only run outside production builds and do not change runtime behavior.
