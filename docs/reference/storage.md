---
title: 'Storage API'
description: 'Factory options, typed reads, writes, expiration, subscriptions, and Storage-compatible methods.'
---

## `createStorage()`

Creates a new storage instance.

```ts
createStorage(options?: CreateStorageOptions): UltraStorage;
```

All options are optional.

| Option       | Type         | Default        | Description                                            |
| ------------ | ------------ | -------------- | ------------------------------------------------------ |
| `prefix`     | `string`     | —              | Key prefix for namespacing                             |
| `separator`  | `string`     | `":"`          | Separator between prefix and key                       |
| `storage`    | `Storage`    | `localStorage` | Where values are saved                                 |
| `serializer` | `Serializer` | `devalue`      | Custom serializer with `stringify` and `parse` methods |

Also available from `ultrastorage/core` where `serializer` is **required** and `devalue` is not bundled. See [Custom serializer](/guides/destinations#custom-serialization).

Returns a `UltraStorage` instance, that has the same interface as [`Storage`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API), with additional APIs.

Create and reuse a namespaced instance for application state:

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'my-app' });
```

## Storage instance

The examples below use the `appStorage` instance created above. Its methods follow the familiar
`Storage` API while accepting rich JavaScript values:

```ts
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

```ts
const userId = '42';

appStorage.setItem('theme', 'dark');
appStorage.setItem(['users', userId], {
  name: 'Alice',
  role: 'admin',
});

appStorage.getItem(['users', userId]);
// { name: 'Alice', role: 'admin' }
```

### `getItem()`

Retrieves and deserializes a stored value.

```ts
appStorage.getItem<T = unknown>(key: StorageKey): T | null;

appStorage.getItem<T>(
  key: StorageKey,
  options: { schema: StandardSchema },
): T | null;
```

Returns `null` if the key is missing, expired, or fails the supplied [schema validation](https://github.com/standard-schema/standard-schema). If the entry is expired, `getItem()` removes it from storage.

Options:

| Option   | Type             | Description                                                     |
| -------- | ---------------- | --------------------------------------------------------------- |
| `schema` | `StandardSchema` | Validate the value during read. Async schemas are not supported |

Use a schema to validate the persisted value and infer its type:

```ts
import { z } from 'zod';

const ThemeSchema = z.enum(['light', 'dark']);
const theme = appStorage.getItem('theme', { schema: ThemeSchema });
// 'light' | 'dark' | null
```

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

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

Store rich values and optionally expire them:

```ts
appStorage.setItem(
  'draft',
  {
    title: 'Introducing ultrastorage',
    updatedAt: new Date(),
  },
  { ttl: 86_400_000 },
);
```

### `removeItem()`

Removes a single key from the current namespace.

```ts
appStorage.removeItem(key: StorageKey): void;
```

```ts
appStorage.removeItem('draft');
appStorage.getItem('draft'); // null
```

### `has()`

Returns `true` if the key exists and is not expired.

```ts
appStorage.has(key: StorageKey): boolean;
```

Expired entries are treated as missing and are not removed by `has()`.

```ts
if (!appStorage.has('preferences')) {
  appStorage.setItem('preferences', { theme: 'system' });
}
```

### `clear()`

Removes all entries written by `ultrastorage` in the current namespace.

```ts
appStorage.clear(): void;
```

Entries outside the namespace and values not written by `ultrastorage` are left untouched.

```ts
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

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

Initialize a value only when the key is missing or expired:

```ts
const preferences = appStorage.getOrInit('preferences', () => ({
  theme: 'system',
  locale: 'en',
}));
```

`getOrInit()` is useful for migrating from an existing `localStorage` (but non-`ultrastorage`) key. To do that, specify a `factory` function that reads from the existing `localStorage` key.

```ts
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

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

```ts
const count = appStorage.updateItem<number>('cart-count', (current) => (current ?? 0) + 1);
// 1 when the key was previously missing
```

### `subscribe()`

Observe one key and receive `set`, `remove`, or `expire` events.

```ts
appStorage.subscribe(
  key: StorageKey,
  listener: StorageListener,
): () => void;
```

Returns an idempotent unsubscribe function. See the [subscription guide](/guides/subscriptions) for the event types, timing, errors, and cross-tab behavior.

Read the latest value when the subscribed key changes:

```ts
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

```ts
appStorage.setItem('search-results', ['first', 'second'], { ttl: 5 * 60_000 });

// Later, such as when the application starts again:
appStorage.clearExpired();
```

### `length`

The number of non-expired entries in the current namespace.

```ts
appStorage.length: number;
```

Expired entries are excluded from the count but not removed unless read via `getItem()` or swept with `clearExpired()`.

Each access scans and decodes entries in the namespace. Use `keys()` to enumerate all keys in one
scan instead of repeatedly reading `length` and calling `key()`.

```ts
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

Keys are returned relative to the prefix. String keys remain strings, and array keys are restored
as fresh arrays containing their original segments. Every returned key can be passed directly to
`getItem()`, `removeItem()`, and other key-taking methods. This return type differs from native
`Storage.key()`, which returns only strings or `null`.

```ts
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

Keys are returned relative to the prefix. String keys remain strings, and array keys are restored
as fresh arrays containing their original segments. Every returned key can be passed directly to
`getItem()`, `removeItem()`, and other key-taking methods.

```ts
appStorage.setItem('theme', 'dark');
appStorage.setItem(['users', '42'], 'Alice');

appStorage.keys(); // ['theme', ['users', '42']]
```

The result is a snapshot: later writes or changes to the returned array, including nested key
arrays, do not affect each other.

```ts
for (const key of appStorage.keys()) {
  console.log(key);
}
```

You can also safely remove entries while looping over the snapshot:

```ts
for (const key of appStorage.keys()) {
  appStorage.removeItem(key);
}
```

## `createMemoryStorage()`

Returns an in-memory `Storage` implementation.

```ts
createMemoryStorage(): Storage;
```

Useful for tests or server-side usage.

```ts
import { createMemoryStorage, createStorage } from 'ultrastorage';

const testStorage = createStorage({
  prefix: 'test',
  storage: createMemoryStorage(),
});

testStorage.setItem('theme', 'dark');
testStorage.getItem('theme'); // 'dark'
```
