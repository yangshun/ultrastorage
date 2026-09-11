---
title: 'Caveats and migration'
description: 'Understand storage limits, synchronization boundaries, invalid data, and migration behavior.'
---

Adding a storage wrapper does not remove browser storage limits or make existing data automatically
compatible.

Before adopting ultrastorage or changing its configuration, understand how it handles older
entries, failed reads, expiration, and notifications. These details help you plan migrations and
avoid unexpected behavior.

## Migrating from greatstorage

ultrastorage was previously published as `greatstorage`. To upgrade:

1. Replace the `greatstorage` dependency with `ultrastorage`.
2. Change imports from `greatstorage` to `ultrastorage`, including `greatstorage/core` to
   `ultrastorage/core`.
3. Rename type imports from `GreatStorage` to `UltraStorage`.

Existing entries marked with `__gs` remain readable, so stored browser data does not need to be
migrated. New writes use `__us`, which older versions of `greatstorage` cannot read. Update
applications that share the same storage together rather than running old and new versions at the
same time.

## Importing existing values

Pass `legacy` to `getItem()` to adopt a value previously written directly to the same
storage backend. The destination uses your instance's namespace; `legacy.key` is an
exact backend key without an added prefix.

```ts app.ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'app' });

// Reads "app:theme" first. If missing, imports the raw "theme" value.
const theme = appStorage.getItem<string>('theme', {
  legacy: {
    key: 'theme',
    deserialize: (raw) => raw,
  },
});
```

The required `deserialize` callback lets you decode JSON, custom formats, or reshape old data.
Pass a synchronous Standard Schema to validate the result and infer its type:

```ts app.ts
import { z } from 'zod';

const preferences = appStorage.getItem('preferences', {
  legacy: {
    key: 'old-settings',
    deserialize: (raw) => {
      const old = JSON.parse(raw);
      return { theme: old.darkMode ? 'dark' : 'light' };
    },
  },
  schema: z.object({ theme: z.enum(['dark', 'light']) }),
});
```

For JSON that needs no reshaping, use `deserialize: JSON.parse`. Without a schema,
the decoder's output is not validated; a generic type argument only describes the expected type.

### Import behavior

- Importing runs only when the destination is physically missing. Existing values win,
  including stored `null`. Malformed, foreign, expired, or schema-invalid destination
  entries do not trigger importing on that call. An expired entry is still removed by
  the normal read path; a later read can import if the legacy source remains.
- A missing legacy key returns `null`. An empty string is a value and reaches the decoder.
  Source and destination must be different keys to import: an occupied source at the
  destination is treated as existing data.
- Successful imports persist the validated, transformed output using the instance's
  serializer, with no expiration. This differs from ordinary schema reads, which return
  transformations without saving them.
- After writing, ultrastorage removes the legacy key. Later reads use the destination,
  and deleting it does not bring back a successfully removed source.
- Decoder exceptions and schema validation issues return `null` and preserve the source.
  Async decoders and async schemas throw a `TypeError`. Thrown schema errors, serialization
  errors, and backend failures propagate.
- Failed writes preserve the legacy source. If source removal fails after writing,
  the read throws but the imported destination remains; subsequent reads use it and do
  not retry source cleanup.
- Successful writes emit the normal `set` notification. Source removal also notifies
  subscriptions to that exact source key. Notifications are delivered after the migration
  attempt, including when cleanup fails after a successful write.

Importing is synchronous and is not atomic across browser tabs. Run it in client startup
code or an effect, before relying on the migrated value. React hooks do not perform legacy
imports themselves, but existing subscribers update when `getItem()` imports a value.
Avoid invoking importing reads during React rendering.

## General caveats

- **Namespaces can overlap**: A broad prefix includes matching nested prefixes, while an unprefixed instance can clear recognized entries across the backend; choose [non-overlapping prefixes](/guides/namespaces).
- **Namespace changes need migration**: Changing `prefix` or `separator` does not rename existing entries and can make them inaccessible through the new configuration; keep [namespace settings](/guides/namespaces) stable or migrate the data explicitly.
- **Reads and writes can throw**: Synchronous backend access, quota, serialization, and thrown schema errors propagate without a memory fallback; even expiration cleanup during a read can fail ([error handling](/reference/storage#error-handling)).
- **Clearing skips unreadable entries**: Corrupted or unsupported envelopes can remain in storage after `clear()` and require [explicit migration or removal](/reference/storage#clear).
- **Changing serializers can strand data**: JSON fallback runs only when the configured parser throws, so use a new prefix and plan [format migration](/guides/destinations#custom-serialization).
- **Rich values have limits**: Functions, promises, symbols, and arbitrary class instances are rejected by default, while custom serializers may lose other values ([serialization limits](/guides/destinations#custom-serialization)).
- **Existing raw values need migration**: Plain-string and plain-JSON entries are invisible until [imported with a legacy read](/guides/caveats#importing-existing-values).
- **`null` has several meanings**: Missing, expired, foreign, unparseable, schema-invalid, and stored-null values can all read as `null`; use [`has()`](/reference/storage#has) to distinguish a recognized stored-null entry from an absent one.
- **Presence does not imply validity**: Bookkeeping and core helpers do not apply a schema; use [explicit read validation](/guides/validation#read-semantics).
- **Ordinary read validation does not rewrite storage**: Synchronous schemas leave invalid entries untouched and return transformations without saving them, while [React setters must write values the schema accepts](/guides/react#schemas-and-types).
- **Helpers are synchronous and non-atomic**: Factories and updaters are not awaited, and read-modify-write operations can race across tabs or callers ([helper semantics](/guides/values#update-a-value)).
- **Initialization can run again**: Stored `null` causes `getOrInit()` to call its factory again, and returning an existing value does not refresh its TTL ([initialization](/guides/values#initialize-a-value)).
- **Updates preserve expiration**: An `updateItem()` call without expiration options keeps the current unexpired deadline. Pass `{ expiresAt: null }` to remove it ([updating values](/guides/values#update-a-value)).
- **Expiration has no timer**: Elapsed time alone triggers neither cleanup nor notifications, and expired entries can occupy storage until [lazy cleanup](/guides/expiration#cleanup-and-notifications).
- **Same-page notifications require the same runtime**: Direct backend writes do not notify locally, and separately loaded package copies or mixed ESM/CJS runtimes do not share a registry ([subscriptions](/guides/subscriptions)).
- **Use the React adapter for rendering**: Ordinary reads return fresh objects and can delete expired entries, while the adapter supplies [cached, side-effect-free snapshots](/guides/react#snapshots-and-expiration).
- **Some string keys alias array keys**: Strings matching the [reserved array-key encoding](/reference/storage#reserved-array-key-encoding) address array keys and are returned as arrays during enumeration.
