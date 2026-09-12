---
title: 'Migration'
description: 'Move existing data into ultrastorage or migrate safely to another storage solution.'
---

Storage migrations should operate on decoded values rather than copying raw backend strings.
ultrastorage wraps values in a versioned envelope and, by default, serializes that envelope with
`devalue`. The examples below preserve data by reading it through the library that wrote it.

## Migrating to ultrastorage

### Importing existing values

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

#### Import behavior

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

### From greatstorage

ultrastorage was previously published as `greatstorage`. To upgrade:

1. Replace the `greatstorage` dependency with `ultrastorage`.
2. Change imports from `greatstorage` to `ultrastorage`, including `greatstorage/core` to
   `ultrastorage/core`.
3. Rename type imports from `GreatStorage` to `UltraStorage`.

Existing entries marked with `__gs` remain readable, so stored browser data does not need to be
migrated. New writes use `__us`, which older versions of `greatstorage` cannot read. Update
applications that share the same storage together rather than running old and new versions at the
same time.

## Migrating away from ultrastorage

Use the public API to enumerate and decode current entries. Do not copy raw `localStorage` or
`sessionStorage` strings: they contain ultrastorage metadata and may use a serializer that the new
solution cannot decode.

For every key returned by `keys()`:

1. Call `getItemResult()` to distinguish a successfully stored `null` from a failed read.
2. Read `getExpiration()` if the destination supports expiration.
3. Convert array keys if the destination accepts only string keys.
4. Write the decoded value to the destination and verify that it can be read back.
5. Remove the ultrastorage entry only after the destination write is known to be durable.

The destination API will differ, but the migration loop should follow this shape:

```ts migrate.ts
import type { StorageKey } from 'ultrastorage';
import { appStorage } from './lib/app-storage';

type Destination = {
  set(key: StorageKey, value: unknown, options: { expiresAt: number | null }): void | Promise<void>;
};

export async function migrateStorage(destination: Destination) {
  for (const key of appStorage.keys()) {
    const result = appStorage.getItemResult(key);
    if (result.status !== 'success') continue;

    const expiration = appStorage.getExpiration(key);
    await destination.set(key, result.value, {
      expiresAt: expiration?.expiresAt ?? null,
    });
  }
}
```

`keys()` returns a snapshot of recognized, non-expired entries. Expired, corrupted, unsupported,
and foreign backend values are skipped. If those bytes also need cleanup, inspect and remove their
exact backend keys separately; `clear()` intentionally leaves unreadable and foreign values alone.

Check that the destination's serializer supports the values your application uses. Plain JSON,
for example, does not faithfully preserve `Date`, `Map`, `Set`, `BigInt`, `undefined`, or circular
references. Also define a reversible encoding for array keys before writing to a destination that
only accepts strings.

### Roll out without losing writes

For applications that may have multiple releases or browser tabs running at once, migrate in
stages:

1. Ship a release that reads the new destination first, falls back to ultrastorage, and writes to
   both.
2. Copy and verify existing values through the migration loop.
3. Stop reading from ultrastorage after old clients are no longer active.
4. Remove the old entries and uninstall the package in a later release.

This prevents an older client from writing fresh ultrastorage data after the one-time copy has
finished. If the stored data is disposable, such as a cache, you can instead clear the namespace
and let the new implementation rebuild it.
