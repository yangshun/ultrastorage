# Changelog

All notable changes to this project will be documented in this file.

## 0.10.0 - 2026-10-28

This release makes imports safer, preserves legacy expiration deadlines, and adds optional persistence diagnostics and default write options to the existing React hooks.

### Breaking changes

- Renamed the `getItem()` option `legacy` to `migrateFrom` and the exported `LegacyOptions` type to `MigrateFromOptions`. Passing `legacy` now throws a descriptive error.
- Import deserializers must synchronously return `{ value, options? }`. Wrap every decoded value, including strings and objects. `options` reuses `StorageOptions`: use `expiresAt` to preserve an absolute deadline or `ttl` to start a new lifetime. Omitted options import without expiration.
- Successful imports retain the source key instead of deleting it. The application owns verification, migration completion tracking, and source cleanup.
- Removed `getItemResult()`. Use `getItem(key, { detailed: true })` instead. The exported `ReadOptions` type was removed; use `GetOptions`.

### Improvements

- Detailed reads include `__result: true` and distinguish successful, missing, expired, unsupported, unparseable, and schema-invalid data. Verified imports additionally return `migrated: true`; ordinary reads still return a value or `null`.
- Imports preserve the supplied expiration, skip expired sources, and protect every occupied destination. Validated output is written and read back before an import is reported as successful. Source data is retained on decoding, validation, serialization, backend, and write failures, including during quota recovery.
- Added `writeOptions` to `useStorage()` and `createStorageHook()` for default expiration policies. Explicit setter expiration replaces the entire default policy; `{ expiresAt: null }` removes expiration. Reads, rerenders, and hydration never refresh deadlines.
- Added opt-in `diagnostics: true` to the existing React hooks. A fourth tuple item exposes `readResult` and the last write or remove error, including unavailable storage and unreadable data. Setters and removers still throw, and the default three-item tuple is unchanged.
- Improved React recovery when storage becomes available again, subscription cleanup, and side-effect-free SSR and hydration.
- Updated the default serializer to devalue 6 and refreshed the documentation toolchain.

### Upgrade notes

Replace standalone detailed reads:

```ts
// Before:
const result = appStorage.getItemResult('draft');

// After:
const result = appStorage.getItem('draft', { detailed: true });
```

Rename `legacy` to `migrateFrom` and wrap the decoded value. Keep legacy format decoding in your application. For an old JSON record containing `{ value, expiresAt }`:

```ts
const result = appStorage.getItem('draft', {
  detailed: true,
  migrateFrom: {
    key: 'old:draft',
    deserialize(raw) {
      const old = JSON.parse(raw);
      return {
        value: old.value,
        options: { expiresAt: old.expiresAt ?? null },
      };
    },
  },
});

if (result.status === 'success' && result.migrated) {
  // The destination value and expiration were written and verified.
  // The source is still retained for application verification and cleanup.
}
```

Use the original absolute `expiresAt` to preserve remaining lifetime. Never supply both `ttl` and `expiresAt`. Decoder exceptions and schema issues become read outcomes; malformed decoder results, invalid options, backend failures, and failed writes still throw.

Use a separate namespace when changing storage formats. Retained source keys can be imported again after a destination is deleted, so coordinate older clients and perform application-owned cleanup or track migration completion. See the [migration guide](https://ultrastorage.dev/guides/migration#importing-existing-values).

React diagnostics expose failures without blocking writes or retaining an unsaved editor buffer. Draft interfaces should use `readResult` to decide when saving is safe, keep unsaved text in application state, and catch setter errors. See the [React guide](https://ultrastorage.dev/guides/react).

## 0.9.0 - 2026-09-16

- **Breaking:** Removed automatic JSON fallback after a serializer parser throws. Reads now use only the configured parser unless `fallbackParser` is explicitly provided, including when using the default `devalue` serializer. ([#4](https://github.com/yangshun/ultrastorage/issues/4))
- Added `fallbackParser` to both `createStorage()` entry points. It runs only after a synchronous primary parser exception; if both parsers throw, `getItemResult()` retains the primary error. Promise or thenable output from either parser throws a synchronous `TypeError`.
- Added opt-in `onQuotaExceeded: 'clear-expired'` recovery. A backend `QuotaExceededError` triggers cleanup of recognized expired entries in the current namespace, followed by one retry of the same serialized write. Cleanup and retry failures propagate.
- Fixed asynchronous custom parsers being silently treated as unsupported data and leaking rejected promises. Promise-like parser output now throws a synchronous `TypeError`, with any rejection consumed. ([#3](https://github.com/yangshun/ultrastorage/pull/3))
- Reorganized internal source into core and React modules while preserving the `ultrastorage`, `ultrastorage/core`, and `ultrastorage/react` entry points.
- Expanded migration, parser error, and quota recovery documentation, and refreshed the documentation site's branding and navigation.

### Upgrade notes

Add `fallbackParser: JSON.parse` to preserve the previous JSON compatibility behavior. Without it, JSON envelopes rejected by the configured parser remain stored but are unreadable, excluded from enumeration, and skipped by `clear()` and `clearExpired()`. Use a compatible parser to migrate them, or `removeItem(key)` to remove known obsolete entries. Writes continue to use `serializer.stringify()`.

```ts
const appStorage = createStorage({
  prefix: 'app',
  fallbackParser: JSON.parse,
});
```

Keep your existing serializer, prefix, separator, and backend settings when adding the fallback. React hooks and reactive expiration follow the storage instance's parsing policy. See the [migration guide](https://ultrastorage.dev/guides/migration#upgrading-from-automatic-json-fallback) for details.

Custom parsers must be synchronous. A promise or thenable now throws instead of returning an `unsupported` result; changing the fallback configuration does not enable async parsing.

Quota recovery is disabled by default. Enabling it does not evict live entries or fall back to memory, and a write can still fail after cleanup and the single retry.

### Contributors

Thanks to [@rickvian](https://github.com/rickvian) for reporting the asynchronous-parser issue ([#2](https://github.com/yangshun/ultrastorage/issues/2)), contributing the fix ([#3](https://github.com/yangshun/ultrastorage/pull/3)), and providing the reproduction and proposal for explicit fallback parsing ([#4](https://github.com/yangshun/ultrastorage/issues/4)).

## 0.8.0 - 2026-09-11

- Added `getItem()` legacy imports with a custom deserializer and optional schema validation. Imports run only when the destination is physically missing, persist the validated value without expiration, and remove the legacy key after a successful write.
- Added `getExpiration()` to inspect stored deadlines without cleanup and `setExpiration()` to change or remove expiration without supplying the value.
- Changed writes without expiration options to preserve the current unexpired deadline, including `updateItem()` and React setters. Pass `{ expiresAt: null }` to remove expiration explicitly.
- Added `getItemResult()` with distinct outcomes for successful reads, missing and expired entries, unsupported data, parse errors, and validation errors. Successful results distinguish stored `null` from a missing value.
- Added opt-in `{ reactiveExpiration: true }` for subscriptions and React hooks. Expiration timers notify listeners and update React values without deleting entries, with rechecks on window focus and page visibility changes.
- Expanded documentation for migration, expiration controls, detailed reads, and reactive expiration, and added a changelog page.

### Upgrade notes

- Previously, writing without expiration options removed an existing deadline. To retain that behavior, pass `{ expiresAt: null }` to `setItem()`, `updateItem()`, or a React setter. Pass a new `ttl` to restart the lifetime instead of preserving the original deadline.
- Reactive expiration remains opt-in. Timer notifications may be delayed, do not remove stored entries, and can be followed by another `expire` event during lazy cleanup.
- Legacy imports are available through `getItem()` only. `getItemResult()` does not import legacy data; backend failures, thrown schema errors, and unsupported asynchronous validation still throw.

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
