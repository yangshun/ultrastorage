---
title: 'Storage API'
description: 'Factory options, typed reads, writes, expiration, subscriptions, and Storage-compatible methods.'
---

## `createStorage(options?: CreateStorageOptions): GreatStorage`

Creates a new storage instance. All options are optional.

| Option       | Type         | Default        | Description                                            |
| ------------ | ------------ | -------------- | ------------------------------------------------------ |
| `prefix`     | `string`     | —              | Key prefix for namespacing                             |
| `separator`  | `string`     | `":"`          | Separator between prefix and key                       |
| `storage`    | `Storage`    | `localStorage` | Underlying Storage backend                             |
| `serializer` | `Serializer` | `devalue`      | Custom serializer with `stringify` and `parse` methods |

Also available from `greatstorage/core` where `serializer` is **required** and `devalue` is not bundled. See [Custom serializer](/guides/backends#custom-serialization).

Returns a `GreatStorage` instance, that has the same interface as [`Storage`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API), with additional APIs.

## `GreatStorage` instance

A `GreatStorage` instance with the following methods:

### `storage.subscribe(key, listener)`

Observe one key and receive `set`, `remove`, or `expire` events. Returns an idempotent unsubscribe function. See the [subscription guide](/guides/subscriptions) for the event types, timing, errors, and cross-tab behavior.

### `storage.getItem<T = unknown>(key: string): T | null`

Retrieves and deserializes a value. Returns `null` if the key is missing or expired. If the entry is expired, `getItem()` removes it from storage.

### `storage.getItem<T>(key: string, options: { schema: StandardSchema }): T | null`

Retrieves and deserializes a value. Returns `null` if the key is missing, expired, or fails [schema validation](https://github.com/standard-schema/standard-schema).

If the entry is expired, `getItem()` removes it from storage.

Options:

| Option   | Type             | Description                                                     |
| -------- | ---------------- | --------------------------------------------------------------- |
| `schema` | `StandardSchema` | Validate the value during read. Async schemas are not supported |

### `storage.setItem<T = unknown>(key: string, value: T, options?: StorageOptions): void`

Serializes and stores a value. Options:

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

### `storage.getOrInit<T>(key: string, factory: () => T, options?: StorageOptions): T`

Returns the existing value for `key`, or calls `factory()` to create, store, and return a new value.

Options:

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

`getOrInit()` is useful for migrating from an existing `localStorage` (but non-`greatstorage`) key. To do that, specify a `factory` function that reads from the existing `localStorage` key.

```ts
const theme = storage.getOrInit('theme', () => localStorage.getItem('theme'));
```

### `storage.updateItem<T = unknown>(key: string, updater: (value: T | null) => T, options?: StorageOptions): T`

Calls `updater(currentValue)` where `currentValue` is the existing value (or `null`), stores the result, and returns it.

Options:

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

### `storage.removeItem(key: string): void`

Removes a single key from the current namespace.

### `storage.has(key: string): boolean`

Returns `true` if the key exists and is not expired. Expired entries are treated as missing and are not removed by `has()`.

### `storage.key(index: number): string | null`

Returns the key at the given zero-based index among non-expired entries, or `null` if the index is out of bounds. Expired entries are skipped but not removed.

### `storage.clear(): void`

Removes all entries written by `greatstorage` in the current namespace.

Entries outside the namespace and values not written by `greatstorage` are left untouched.

### `storage.clearExpired(): void`

Removes only expired entries in the current namespace.

### `storage.length: number`

The number of non-expired entries in the current namespace.

Expired entries are excluded from the count but not removed unless read via `getItem()` or swept with `clearExpired()`.

## `createMemoryStorage(): Storage`

Returns an in-memory `Storage` implementation. Useful for tests or server-side usage.
