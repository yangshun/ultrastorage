---
title: 'Migration'
description: 'Move existing data into ultrastorage or migrate safely to another storage solution.'
---

Storage migrations should operate on decoded values rather than copying raw backend strings.
ultrastorage wraps values in a versioned envelope and, by default, serializes that envelope with
`devalue`. The examples below preserve data by reading it through the library that wrote it.

The default serializer uses devalue 6. Supported entries written with devalue 5 remain readable,
including rich values, shared and circular references, and expiration metadata. Keep the same
backend, prefix, and separator when upgrading; no stored-data conversion is required for this
serializer update.

## Upgrading from automatic JSON fallback

Earlier versions tried `JSON.parse()` automatically when the configured parser threw. Fallback
is now opt-in, including when using the default `devalue` serializer. To preserve the previous
behavior, add `fallbackParser: JSON.parse` to each instance that needs to read JSON envelopes:

```ts lib/app-storage.ts
import { createStorage } from 'ultrastorage';

export const appStorage = createStorage({
  prefix: 'app',
  fallbackParser: JSON.parse,
});
```

The same option works with custom serializers and `ultrastorage/core`. Keep any existing
`serializer`, prefix, separator, and backend configuration when adding it.

Without fallback, entries the primary parser rejects remain in storage. `getItemResult()` returns
`parse-error`, `getItem()` returns `null`, and enumeration, `clear()`, and `clearExpired()` skip them.
React hooks and reactive expiration use the same parsing policy. Read-modify-write helpers can
replace an unreadable entry, so configure compatibility before using them on old data.

Fallback reads do not rewrite the format. To migrate an entry, read it successfully through a
compatible instance, then write its value with the new serializer while preserving any expiration
you need. Keep compatibility enabled while older clients can still write the old format. To remove
a known obsolete entry without decoding it, use `removeItem(key)`.

Fallback parsers must return a recognized ultrastorage envelope. For ordinary JSON values or raw
strings written outside ultrastorage, use [legacy imports](#importing-existing-values).

## Migrating to ultrastorage

### Importing existing values

Pass `migrateFrom` to `getItem()` to adopt an entry previously written to the same backend.
The destination uses your instance's namespace; `migrateFrom.key` is the exact source key,
without an added prefix. Use a new, non-overlapping prefix when changing formats.

```ts lib/app-storage.ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'app-ultra-v1' });

const theme = appStorage.getItem<string>('theme', {
  migrateFrom: {
    key: 'old:theme',
    deserialize: (raw) => ({ value: raw }),
  },
});
```

`deserialize` must synchronously return an object with `value` and optional `options`.
The options reuse `StorageOptions`: `ttl` starts a lifetime at import time, `expiresAt` sets
an absolute timestamp or `Date`, and `expiresAt: null` means no expiration. Never specify both
`ttl` and `expiresAt`. Omitted options import without expiration.

Keep format decoding in your app. For example, if an old JSON record contains `{ value, expiry }`:

```ts app.ts
const promo = appStorage.getItem('promo', {
  migrateFrom: {
    key: 'old:promo',
    deserialize(raw) {
      const old = JSON.parse(raw);
      return {
        value: old.value,
        options: { expiresAt: old.expiry ?? null },
      };
    },
  },
});
```

Use the original absolute deadline to preserve remaining lifetime. Migration never adds back
elapsed time. Already-expired data is skipped, with the original source retained. A deadline
is still valid at the exact timestamp, matching ordinary reads.

Add a synchronous Standard Schema to validate the decoded value and infer its output type:

```ts app.ts
import { z } from 'zod';

const preferences = appStorage.getItem('preferences', {
  migrateFrom: {
    key: 'old:settings',
    deserialize: (raw) => ({ value: JSON.parse(raw) }),
  },
  schema: z.object({ theme: z.enum(['dark', 'light']) }),
});
```

#### Breaking change from legacy

The `legacy` option was renamed to `migrateFrom`; old calls now throw a descriptive error.
Rename the exported `LegacyOptions` type to `MigrateFromOptions` too. All deserializers must
return the wrapper, including strings and JSON objects:

```ts
// Before:
// legacy: { key: 'old', deserialize: JSON.parse }

// After:
// migrateFrom: { key: 'old', deserialize: raw => ({ value: JSON.parse(raw) }) }
```

The source is now retained after success instead of automatically deleted. After verifying the
new data, the app can remove the exact source key with the backend's `removeItem()`. Retained
sources can be imported again if the destination is deleted. Plan app-owned cleanup or migration
completion tracking, and coordinate older clients that can still write the source format.

#### Import behavior

- Importing runs only when the destination is physically missing. Existing values win,
  including stored `null`, malformed, foreign, expired, or schema-invalid entries. An expired
  destination is removed by the ordinary read path; a later read can attempt importing.
- A missing source returns `null`. Empty source strings reach the deserializer. Source and
  destination at the same physical key cannot trigger an import.
- The validated, transformed output is serialized with the supplied expiration. Reads of an
  existing destination do not call the deserializer or refresh its deadline.
- Source bytes and destination presence are checked again after user callbacks. A newer
  destination wins; a changed source throws so the app can retry instead of copying stale data.
- After writing, the destination is read back to verify its bytes, recognized envelope, and
  expiration. Failed verification throws and can leave destination bytes behind for inspection.
- Decoder exceptions and schema issues return `null`, retaining the source. Malformed wrappers,
  invalid options, and asynchronous callbacks throw a `TypeError`. Thrown schema, serialization,
  and backend errors propagate. Every import failure retains the source.
- With quota recovery enabled, expired entries in the destination namespace may be cleared and
  the write retried once. The source key is excluded from this cleanup.
- Successful changed writes emit the ordinary `set` notification after verification. Source
  retention emits no removal notification.

Importing is synchronous and is not atomic across tabs. Run importing reads in browser startup,
an effect, or an event handler, never React rendering. Hooks do not import by themselves, but
mounted subscribers update when a `getItem()` call imports a value.

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
