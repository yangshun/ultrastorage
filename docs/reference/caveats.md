---
title: 'Caveats and migration'
description: 'Understand storage limits, synchronization boundaries, invalid data, and migration behavior.'
---

- **Same-page writes must go through GreatStorage to notify**: Direct backend writes do not emit same-page notifications. Cross-tab browser events are still observed. Coordination is limited to instances sharing one loaded library runtime; separately bundled copies and mixed ESM/CJS runtimes do not share a registry.
- **Use the React adapter for rendering**: `getItem()` returns fresh objects and can delete expired entries. `greatstorage/react` supplies cached, side-effect-free snapshots internally; no public snapshot API is exposed.
- **Still synchronous storage**: This wraps `localStorage`-style APIs, so reads and writes are still synchronous and still subject to browser storage quotas.
- **Changing serializers can strand old entries**: `getItem()` has a JSON fallback, but enumeration-based APIs like `clear()`, `clearExpired()`, `key()`, and `length` depend on the current serializer being able to parse old values. If you ever need to change serializers, we recommend changing the `prefix` and using a new namespace.
- **Expired entries are cleaned up lazily**: Expired data is hidden from reads immediately, but it may still occupy storage until `getItem()` touches it or `clearExpired()` is called.
- **`null` means several things**: `getItem()` returns `null` for missing keys, expired entries, foreign values not written by `greatstorage`, parse failures, and schema validation failures.
- **Stored `null` and missing keys look the same**: If that distinction matters, pair `getItem()` with `has()`.
- **Existing raw `localStorage` values are invisible**: This library only reads entries with its internal marker, so migrating older plain-string or plain-JSON data requires explicit migration code. You can use `getOrInit()` for this purpose, specifying a `factory` function that reads from the existing `localStorage` key.
- **No atomic updates across tabs or callers**: `getOrInit()` and `updateItem()` are read-modify-write helpers, not transactional operations.
- **Schema validation is sync-only and non-destructive**: Async schemas throw, and invalid stored values return `null` without being removed automatically.
