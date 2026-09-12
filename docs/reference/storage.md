---
title: 'Storage API'
description: 'Factory options, typed reads, writes, expiration, subscriptions, and key enumeration.'
---

## `createStorage()`

Creates a new storage instance.

```ts
createStorage(options?: CreateStorageOptions): UltraStorage;
```

All options are optional.

| Option       | Type         | Default        | Description                                                |
| ------------ | ------------ | -------------- | ---------------------------------------------------------- |
| `prefix`     | `string`     | None           | Key prefix for namespacing                                 |
| `separator`  | `string`     | `":"`          | Advanced override for the separator between prefix and key |
| `storage`    | `Storage`    | `localStorage` | Where values are saved                                     |
| `serializer` | `Serializer` | `devalue`      | Custom serializer with `stringify` and `parse` methods     |

Keep the default `:` separator unless you need to match an existing stored-key convention; see
[custom separators](/guides/namespaces#custom-separators). Changing `prefix` or `separator` after
writing data requires explicit migration to keep existing entries accessible through the new
configuration.

Also available from `ultrastorage/core` where `serializer` is **required** and `devalue` is not bundled. See [Custom serializer](/guides/destinations#custom-serialization).

Returns an `UltraStorage` instance. ultrastorage provides familiar `Storage` methods, with typed
reads, rich-value serialization, expiration, namespacing, and subscriptions.

`getItem()` returns deserialized values rather than always returning strings. Named property access
such as `storage.theme` is unsupported; use `getItem('theme')` and `setItem('theme', value)`.
Existing raw storage values require [explicit migration](/guides/migration), and `clear()` only removes
recognized entries within the configured namespace.

Create and reuse a namespaced instance for application state:

```ts lib/app-storage.ts
import { createStorage } from 'ultrastorage';

export const appStorage = createStorage({ prefix: 'acme' });
```

## Storage instance

The examples below use the `appStorage` instance created above. Its methods follow the familiar
`Storage` API while accepting rich JavaScript values:

```ts app.ts
import { appStorage } from './lib/app-storage';

appStorage.setItem('theme', 'dark');
appStorage.getItem('theme'); // 'dark'
```

The `UltraStorage` instance exposes the following methods and properties. Signatures below use `appStorage` as the instance name.

### `StorageKey`

Key-taking methods use the exported `StorageKey` type:

```ts
type StorageKey = string | readonly string[];
```

String keys are stored unchanged relative to the namespace. Array keys are serialized from their
ordered string segments into an opaque canonical string without using `separator`.

Use a string for a single identifier or an array to preserve structural segments:

```ts app.ts
const userId = '42';

appStorage.setItem('theme', 'dark');
appStorage.setItem(['users', userId], {
  name: 'Alice',
  role: 'admin',
});

appStorage.getItem(['users', userId]);
// { name: 'Alice', role: 'admin' }
```

#### Reserved array-key encoding

Avoid authoring string keys beginning with `\u0000us:a:`, the reserved prefix used to encode array
keys. A string that exactly matches a canonical array encoding addresses the same entry:

```ts app.ts
appStorage.setItem(['users', '42'], 'Alice');
appStorage.getItem('\u0000us:a:["users","42"]'); // 'Alice'
```

`key()` and `keys()` return such a key as an array even if it was originally passed as an encoded
string. Other string keys remain strings. Use the original array when addressing an array key;
subscription events also supply a reusable encoded string through `change.key`.

### `getItem()`

Retrieves and deserializes a stored value.

```ts
appStorage.getItem<T = unknown>(key: StorageKey): T | null;

appStorage.getItem<T>(
  key: StorageKey,
  options: { schema?: StandardSchema; legacy?: LegacyOptions },
): T | null;
```

Returns `null` if the key is missing, expired, or fails the supplied [schema validation](https://github.com/standard-schema/standard-schema). If the entry is expired, `getItem()` removes it from storage.

Foreign values, unrecognized envelopes, and entries that cannot be parsed also return `null`.
Backend access failures, failed expiration cleanup, and thrown schema errors propagate; see
[error handling](#error-handling).

Options:

| Option   | Type             | Description                                                                                                                                  |
| -------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` | `StandardSchema` | Validate the value during read. Async schemas are not supported                                                                              |
| `legacy` | `LegacyOptions`  | Import a legacy key when the destination is physically missing; see [importing existing values](/guides/migration#importing-existing-values) |

Use a schema to validate the persisted value and infer its type:

```ts app.ts
import { z } from 'zod';

const ThemeSchema = z.enum(['light', 'dark']);
const theme = appStorage.getItem('theme', { schema: ThemeSchema });
// 'light' | 'dark' | null
```

With `legacy: { key, deserialize }`, a missing destination triggers a one-time import from
an exact key in the same backend. The synchronous decoder receives the raw string. A successful
import stores the schema output (or decoded value) without expiration, removes the source,
and notifies subscribers. This opted-in read can write and throw on write or cleanup failures.
See [importing existing values](/guides/migration#importing-existing-values) for examples and failure behavior.

### `getItemResult()`

Reads a value with a distinct outcome for each reason it could not be returned.
`getItem()` keeps its existing value-or-null behavior.

```ts
appStorage.getItemResult<T = unknown>(key: StorageKey, options?: ReadOptions<T>): StorageReadResult<T>;
```

`ReadOptions` accepts a Standard Schema via `schema`, with the same synchronous validation
and output inference as `getItem()`. Legacy import is available only through `getItem()`.
Both types are exported from `ultrastorage` and `ultrastorage/core`.

| `status`           | Additional fields                           | Meaning                                                                                               |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `success`          | `value: T`                                  | Read succeeded, including stored `null` or `undefined`.                                               |
| `missing`          | None                                        | No entry exists at the key.                                                                           |
| `expired`          | `expiresAt: number`                         | The deadline passed; the entry was removed.                                                           |
| `unsupported`      | None                                        | Parsed data is foreign, has an unsupported version, or has an invalid envelope.                       |
| `parse-error`      | `error: unknown`                            | Both the configured parser and JSON fallback failed; `error` is the configured parser's thrown value. |
| `validation-error` | `issues: readonly StandardSchemaV1.Issue[]` | The schema returned validation issues.                                                                |

```ts app.ts
const result = appStorage.getItemResult<string | null>('theme');

if (result.status === 'success') {
  console.log(result.value); // A stored null is a successful read.
} else if (result.status === 'missing') {
  appStorage.setItem('theme', 'light');
} else if (result.status === 'validation-error') {
  console.error(result.issues);
}
```

Like `getItem()`, this method removes an expired entry when `Date.now() > expiresAt`
and emits an `expire` notification to subscribers. At the exact deadline the entry is
still readable. A subsequent read after cleanup returns `missing`. Expiration is checked
before schema validation. Other unsuccessful outcomes preserve the stored bytes.

The configured serializer is tried first; JSON is tried only if that parser throws.
Valid current `__us` and legacy `__gs` envelopes are both accepted. Backend access and
removal failures, exceptions thrown by schemas, and unsupported asynchronous validation
still throw. These operational failures are not converted into read statuses.

### `setItem()`

Serializes and stores a value.

```ts
appStorage.setItem<T = unknown>(
  key: StorageKey,
  value: T,
  options?: StorageOptions,
): void;
```

Options:

| Option      | Type                     | Description                                |
| ----------- | ------------------------ | ------------------------------------------ |
| `ttl`       | `number`                 | Finite time-to-live in milliseconds        |
| `expiresAt` | `Date \| number \| null` | Absolute deadline; null removes expiration |

`ttl` and `expiresAt` cannot be used together, including `expiresAt: null`.
Omitting expiration options preserves the current unexpired deadline. Missing, expired,
unreadable, and non-expiring entries are written without expiration. Pass `expiresAt: null`
to explicitly remove expiration.

Store rich values and optionally expire them:

```ts app.ts
appStorage.setItem(
  'draft',
  {
    title: 'Introducing ultrastorage',
    updatedAt: new Date(),
  },
  { ttl: 86_400_000 },
);
```

### `getExpiration()`

Inspect an entry's expiration without reading its value or performing cleanup.

```ts
appStorage.getExpiration(key: StorageKey): StorageExpiration | null;

interface StorageExpiration {
  expiresAt: number | null;
}
```

Returns the stored deadline as a Unix timestamp in milliseconds, or `{ expiresAt: null }`
for a non-expiring entry. Missing and unreadable entries return `null`. A stored `null` value
still has inspectable expiration.

Expired entries retain their inspectable deadline until they are physically removed, such as
by `getItem()` or `clearExpired()`. Inspection does not remove data or notify subscribers.
The result is a fresh snapshot. Backend read errors propagate.

A deadline has passed when `Date.now() > expiresAt`; subtract `Date.now()` from the timestamp
to calculate remaining lifetime, which is negative after expiration.

### `setExpiration()`

Change an existing entry's expiration while preserving its value.

```ts
appStorage.setExpiration(key: StorageKey, options: ExpirationOptions | null): boolean;

type ExpirationOptions =
  | { ttl: number; expiresAt?: never }
  | { expiresAt: Date | number; ttl?: never };
```

`ttl` sets a lifetime from now; `expiresAt` sets an absolute deadline. Pass `null` to remove
expiration. Returns `true` when applied to an existing, unexpired entry, including an unchanged
deadline. Returns `false` for missing, expired, or unreadable entries without cleanup.

Options must specify exactly one finite expiration, or be `null`; invalid options throw
`TypeError`, even for missing entries. Backend and serialization failures propagate.
An unchanged deadline skips the write; changed serialized content emits `set`. Past deadlines
remain lazy: the next `getItem()` removes the expired entry and emits `expire`.
The operation rewrites the serialized envelope and is not atomic across tabs.

See [expiration controls](/guides/expiration#change-expiration) for examples.

### `removeItem()`

Removes a single key from the current namespace.

```ts
appStorage.removeItem(key: StorageKey): void;
```

```ts app.ts
appStorage.removeItem('draft');
appStorage.getItem('draft'); // null
```

### `has()`

Returns `true` if the key exists and is not expired.

```ts
appStorage.has(key: StorageKey): boolean;
```

Expired entries are treated as missing and are not removed by `has()`.

This checks for a recognized, non-expired entry, including stored `null`. It does not apply schema
validation, so it can return `true` while a [validated read](/guides/validation#read-semantics)
returns `null`.

```ts app.ts
if (!appStorage.has('preferences')) {
  appStorage.setItem('preferences', { theme: 'system' });
}
```

### `clear()`

Removes all recognized entries in the current namespace, including expired entries.

```ts
appStorage.clear(): void;
```

Entries outside the namespace and values not written by `ultrastorage` are left untouched.

Corrupted envelopes, unsupported format versions, and entries unreadable by the configured parser
and its JSON fallback are also skipped. They can remain in the backend and occupy space after
`clear()` or `clearExpired()`. To discard a known unreadable entry, call `removeItem(key)`; it does
not require the value to be readable. During a format migration, use the old serializer to read
entries you need to retain before removing them.

Scope follows string-prefix matching: overlapping prefixes can include each other's data, and an
instance without a prefix matches recognized entries across the backend. See
[namespace overlap](/guides/namespaces).

```ts app.ts
appStorage.setItem('theme', 'dark');
localStorage.setItem('analytics-id', 'abc123');

appStorage.clear();

appStorage.getItem('theme'); // null
localStorage.getItem('analytics-id'); // 'abc123'
```

### `getOrInit()`

Returns the existing value for `key`, or calls `factory()` to create, store, and return a new value.

```ts
appStorage.getOrInit<T>(
  key: StorageKey,
  factory: () => T,
  options?: StorageOptions,
): T;
```

Options:

| Option      | Type                     | Description                                |
| ----------- | ------------------------ | ------------------------------------------ |
| `ttl`       | `number`                 | Finite time-to-live in milliseconds        |
| `expiresAt` | `Date \| number \| null` | Absolute deadline; null removes expiration |

`ttl` and `expiresAt` cannot be used together, including `expiresAt: null`.
Omitting expiration options preserves the current unexpired deadline. Missing, expired,
unreadable, and non-expiring entries are written without expiration. Pass `expiresAt: null`
to explicitly remove expiration.

Initialize a value when an ordinary read returns `null`:

```ts app.ts
const preferences = appStorage.getOrInit('preferences', () => ({
  theme: 'system',
  locale: 'en',
}));
```

This includes missing, expired, unreadable, and stored-null values. A factory returning `null` runs
again on the next call. Existing non-null values are returned without schema validation or changes
to their expiration; options apply only when the factory result is written.

Factories must be synchronous, and initialization is not atomic across tabs or concurrent callers;
see [synchronous helpers](/guides/values#update-a-value).

`getOrInit()` is useful for migrating from an existing `localStorage` (but non-`ultrastorage`) key. To do that, specify a `factory` function that reads from the existing `localStorage` key.

```ts app.ts
const theme = appStorage.getOrInit('theme', () => localStorage.getItem('theme'));
```

### `updateItem()`

Calls `updater(currentValue)` where `currentValue` is the existing value (or `null`), stores the result, and returns it.

```ts
appStorage.updateItem<T = unknown>(
  key: StorageKey,
  updater: (value: T | null) => T,
  options?: StorageOptions,
): T;
```

Options:

| Option      | Type                     | Description                                |
| ----------- | ------------------------ | ------------------------------------------ |
| `ttl`       | `number`                 | Finite time-to-live in milliseconds        |
| `expiresAt` | `Date \| number \| null` | Absolute deadline; null removes expiration |

`ttl` and `expiresAt` cannot be used together, including `expiresAt: null`.
Omitting expiration options preserves the current unexpired deadline. Missing, expired,
unreadable, and non-expiring entries are written without expiration. Pass `expiresAt: null`
to explicitly remove expiration.

```ts app.ts
const count = appStorage.updateItem<number>('cart-count', (current) => (current ?? 0) + 1);
// 1 when the key was previously missing
```

Omitting expiration options preserves the current unexpired deadline; passing a TTL starts a new
lifetime from this write. Pass `expiresAt: null` to remove expiration. The updater must be synchronous and receives the value without schema validation.
Updates are not atomic across tabs or concurrent callers; see [synchronous helpers](/guides/values#update-a-value).

### `subscribe()`

Observe one key and receive `set`, `remove`, or `expire` events.

```ts
appStorage.subscribe(
  key: StorageKey,
  listener: StorageListener,
  options?: SubscribeOptions,
): () => void;
```

`SubscribeOptions` is exported from the main and core entry points. Its optional
`reactiveExpiration: boolean` defaults to `false`. When enabled, timer-driven `expire` events
notify this subscription without deleting data; later cleanup may emit another `expire` event.

Returns an idempotent unsubscribe function that also cancels its timer. See the [subscription guide](/guides/subscriptions) for the event types, timing, errors, and cross-tab behavior.

Read the latest value when the subscribed key changes:

```ts app.ts
const unsubscribe = appStorage.subscribe('theme', (change) => {
  const theme = appStorage.getItem<'light' | 'dark'>('theme');
  console.log(change.type, theme);
});

appStorage.setItem('theme', 'dark'); // Logs: set dark
unsubscribe();
```

### `clearExpired()`

Removes only expired entries in the current namespace.

```ts
appStorage.clearExpired(): void;
```

```ts app.ts
appStorage.setItem('search-results', ['first', 'second'], { ttl: 5 * 60_000 });

// Later, such as when the application starts again:
appStorage.clearExpired();
```

Only recognized entries can be checked for expiration; unreadable entries are skipped, as with
[`clear()`](#clear).

### `length`

The number of non-expired entries in the current namespace.

```ts
appStorage.length: number;
```

Expired entries are excluded from the count but not removed unless read via `getItem()` or swept with `clearExpired()`.

Each access scans and decodes entries in the namespace. Use `keys()` to enumerate all keys in one
scan instead of repeatedly reading `length` and calling `key()`.

```ts app.ts
appStorage.setItem('theme', 'dark');
appStorage.setItem('locale', 'en');

console.log(appStorage.length); // 2
```

### `key()`

Returns the key at the given zero-based index among non-expired entries, or `null` if the index is out of bounds.

```ts
appStorage.key(index: number): StorageKey | null;
```

Expired entries are skipped but not removed. Each call scans and decodes entries from the beginning
until it reaches the requested index. Repeated calls to enumerate every key perform quadratic
work; use `keys()` for full enumeration.

Keys are returned relative to the prefix. Array keys are restored as fresh arrays containing their
original segments; string keys remain strings except for [reserved array encodings](#reserved-array-key-encoding).
Every returned key can be passed directly to
`getItem()`, `removeItem()`, and other key-taking methods. This return type differs from native
`Storage.key()`, which returns only strings or `null`.

```ts app.ts
appStorage.setItem('theme', 'dark');
appStorage.setItem(['users', '42'], 'Alice');

appStorage.key(0); // 'theme'
appStorage.key(1); // ['users', '42']
appStorage.key(2); // null
```

### `keys()`

Returns a fresh array of recognized, non-expired keys in the current namespace, in backend
enumeration order.

```ts
appStorage.keys(): StorageKey[];
```

This method scans the backend once and decodes each matching entry once. Expiration is evaluated
against the time when the call starts. Expired and foreign entries are skipped without removing
anything or notifying subscribers.

Keys are returned relative to the prefix. Array keys are restored as fresh arrays containing their
original segments; string keys remain strings except for [reserved array encodings](#reserved-array-key-encoding).
Every returned key can be passed directly to
`getItem()`, `removeItem()`, and other key-taking methods.

```ts app.ts
appStorage.setItem('theme', 'dark');
appStorage.setItem(['users', '42'], 'Alice');

appStorage.keys(); // ['theme', ['users', '42']]
```

The result is a snapshot: later writes or changes to the returned array, including nested key
arrays, do not affect each other.

```ts app.ts
for (const key of appStorage.keys()) {
  console.log(key);
}
```

You can also safely remove entries while looping over the snapshot:

```ts app.ts
for (const key of appStorage.keys()) {
  appStorage.removeItem(key);
}
```

## Error handling

Storage operations are synchronous and remain subject to backend access restrictions and storage
quotas. Backend exceptions, serialization errors on writes, factory or updater exceptions, and
thrown schema errors propagate to the caller. Async schemas throw a `TypeError`.

Even a read can fail: `getItem()` removes expired entries, so a backend removal error is thrown
instead of returning `null`. In contrast, unrecognized data and schema issues return `null`, and
parser errors follow the [JSON fallback rules](/guides/destinations#custom-serialization).

Handle failures where you call the API; ultrastorage does not silently substitute an in-memory
backend. Bulk clearing can partially complete before a backend error, with no rollback. Completed
removals still notify subscribers. Subscriber exceptions are handled separately and do not turn a
completed write into a failure; see [event delivery](/guides/subscriptions#events-and-delivery).

## `createMemoryStorage()`

Returns an in-memory `Storage` implementation.

```ts
createMemoryStorage(): Storage;
```

Useful for tests or server-side usage.

```ts app.ts
import { createMemoryStorage, createStorage } from 'ultrastorage';

const testStorage = createStorage({
  prefix: 'test',
  storage: createMemoryStorage(),
});

testStorage.setItem('theme', 'dark');
testStorage.getItem('theme'); // 'dark'
```
