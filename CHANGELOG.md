# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Added optional React 18/19 bindings through `greatstorage/react`: `useStorage` and `createStorageHook`, with typed fallbacks, schema reads, functional updates, and expiration options.
- Added cached, side-effect-free internal snapshots and SSR/hydration support. Core reads retain their existing fresh-object and lazy-cleanup behavior.
- Deferred default `localStorage` access until the first operation, making instance construction safe on the server. Backend failures now occur on use rather than construction; no memory fallback is introduced.
- Added adapter rendering, hydration, subscription, failure, and type coverage. `vp run test:coverage` enforces 100% runtime coverage.

## 0.5.0 - 2026-03-10

`greatstorage` 0.5.0 focuses on better bundle control for custom serializers and safer development ergonomics.

### Highlights

- Added a new `greatstorage/core` entry point for applications that provide their own serializer and want to avoid bundling `devalue`.
- Added development-only warnings for two easy-to-miss cases:
  - writing `null`, which reads back the same as a missing key via `getItem()`
  - writing values with an expiry that is already in the past
- Expanded test coverage for the new core entry point and the warning behavior.
- Improved the README to document the new entry point and clarify the public API.

### Why `greatstorage/core` exists

The default `greatstorage` entry point still includes `devalue` so rich JavaScript values work out of the box. If you already use a custom serializer such as `superjson`, `greatstorage/core` lets you keep the same storage API while making the serializer explicit and avoiding the extra default serialization dependency in your bundle.

### Upgrade notes

- No breaking changes in the default `greatstorage` entry point.
- `greatstorage/core` is new in this release. Its `createStorage()` requires a `serializer`.
- The new warnings only run outside production builds and do not change runtime behavior.
