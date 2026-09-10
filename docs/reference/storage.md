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

## Storage instance

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'my-app' });
```

The `UltraStorage` instance exposes the following methods and properties. Signatures below use `appStorage` as the instance name.

### `getItem()`

Retrieves and deserializes a stored value.

```ts
appStorage.getItem<T = unknown>(key: string): T | null;

appStorage.getItem<T>(
  key: string,
  options: { schema: StandardSchema },
): T | null;
```

Returns `null` if the key is missing, expired, or fails the supplied [schema validation](https://github.com/standard-schema/standard-schema). If the entry is expired, `getItem()` removes it from storage.

Options:

| Option   | Type             | Description                                                     |
| -------- | ---------------- | --------------------------------------------------------------- |
| `schema` | `StandardSchema` | Validate the value during read. Async schemas are not supported |

### `setItem()`

Serializes and stores a value.

```ts
appStorage.setItem<T = unknown>(
  key: string,
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

### `removeItem()`

Removes a single key from the current namespace.

```ts
appStorage.removeItem(key: string): void;
```

### `has()`

Returns `true` if the key exists and is not expired.

```ts
appStorage.has(key: string): boolean;
```

Expired entries are treated as missing and are not removed by `has()`.

### `clear()`

Removes all entries written by `ultrastorage` in the current namespace.

```ts
appStorage.clear(): void;
```

Entries outside the namespace and values not written by `ultrastorage` are left untouched.

### `getOrInit()`

Returns the existing value for `key`, or calls `factory()` to create, store, and return a new value.

```ts
appStorage.getOrInit<T>(
  key: string,
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

`getOrInit()` is useful for migrating from an existing `localStorage` (but non-`ultrastorage`) key. To do that, specify a `factory` function that reads from the existing `localStorage` key.

```ts
const theme = appStorage.getOrInit('theme', () => localStorage.getItem('theme'));
```

### `updateItem()`

Calls `updater(currentValue)` where `currentValue` is the existing value (or `null`), stores the result, and returns it.

```ts
appStorage.updateItem<T = unknown>(
  key: string,
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

### `subscribe()`

Observe one key and receive `set`, `remove`, or `expire` events.

```ts
appStorage.subscribe(
  key: string,
  listener: StorageListener,
): () => void;
```

Returns an idempotent unsubscribe function. See the [subscription guide](/guides/subscriptions) for the event types, timing, errors, and cross-tab behavior.

### `clearExpired()`

Removes only expired entries in the current namespace.

```ts
appStorage.clearExpired(): void;
```

### `length`

The number of non-expired entries in the current namespace.

```ts
appStorage.length: number;
```

Expired entries are excluded from the count but not removed unless read via `getItem()` or swept with `clearExpired()`.

### `key()`

Returns the key at the given zero-based index among non-expired entries, or `null` if the index is out of bounds.

```ts
appStorage.key(index: number): string | null;
```

Expired entries are skipped but not removed.

## `createMemoryStorage()`

Returns an in-memory `Storage` implementation.

```ts
createMemoryStorage(): Storage;
```

Useful for tests or server-side usage.
