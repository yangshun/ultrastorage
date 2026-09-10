# Changelog

All notable changes to this project will be documented in this file.

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
