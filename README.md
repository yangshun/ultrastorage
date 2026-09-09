# greatstorage

Gives `localStorage` superpowers. Handles serialization of rich types, key expiration, namespacing, and schema validation — so you don't have to.

## Features

- **Store anything**: Stores `Set`, `Map`, `Date`, `RegExp`, `BigInt`, circular references, and more using [devalue](https://github.com/sveltejs/devalue)
- **TTL / expiration**: Set a `ttl` in milliseconds or an absolute `expiresAt` timestamp. Expired items are treated as missing, can be removed on `getItem()`, and can be swept with `clearExpired()`
- **Namespacing**: Isolate keys with a configurable `prefix` and `separator`
- **Subscriptions**: React to key changes within a page and across tabs sharing `localStorage`
- **Schema validation**: Validate retrieved values against any [Standard Schema](https://github.com/standard-schema/standard-schema) with synchronous validation (Zod, Valibot, ArkType, etc.)
- **Use any `Storage` backend**: Works with `localStorage`, `sessionStorage`, or any `Storage`-compatible implementation. An in-memory storage implementation is provided as well
- **ESM and CJS**: Tree-shakeable dual builds with full TypeScript types

## Installation

```sh
npm install greatstorage
```

## How it works

Internally, every value is stored as an object rather than being written to the storage raw. That object carries the user `value`, an optional `expiry`, a `version`, and an internal `__gs` marker. The marker is there so `greatstorage` can reliably tell its own entries apart from unrelated keys already living in the same `Storage`. The version is there so the on-disk format can evolve later without guessing which shape an older entry used if this library ever needs to change the internal storage structure.

Refer to the [longer section](#how-it-works-longer-version) below for more explanation regarding internals and design decisions.

## Usage

### Basic

Store and retrieve objects without the `JSON.stringify` dance. You're welcome.

```ts
// lib/storage.ts
import { createStorage } from 'greatstorage';

// Create an app-wide singleton instance.
export const storage = createStorage();
```

```ts
// app.ts
import { storage } from './lib/storage';

storage.setItem('user', { name: 'Alice', age: 30 });
storage.getItem('user'); // { name: 'Alice', age: 30 }
```

### Store anything

Yes, `localStorage` can finally handle a `Set`, or any data type you throw at it. It only took the entire JavaScript ecosystem to get here.

Uses [devalue](https://github.com/sveltejs/devalue) by default, but you can bring your own serializer.

```ts
storage.setItem('tags', new Set(['a', 'b', 'c']));
storage.getItem('tags'); // Set {'a', 'b', 'c'}

storage.setItem('metadata', new Map([['key', 'value']]));
storage.getItem('metadata'); // Map {'key' => 'value'}

storage.setItem('date', new Date('2025-01-01'));
storage.getItem('date'); // Date 2025-01-01T00:00:00.000Z
```

### TTL / expiration

Store data temporarily. Like Snapchat, but for your storage keys.

**Note**: Expired data behaves like a missing key. `getItem()` removes expired entries on read, while `has()`, `key()`, and `length` simply ignore them. Use `clearExpired()` to proactively sweep them.

```ts
// Expires in 60 seconds
storage.setItem('token', 'abc123', { ttl: 60_000 });

// Expires at a specific date
storage.setItem('session', { id: 1 }, { expiresAt: new Date('2025-12-31') });

// Expired items return null
storage.getItem('token'); // null (after 60s)
```

### Namespacing

Because your keys deserve their own personal space, away from whatever chaos other libraries left behind.

```ts
const appStorage = createStorage({ prefix: 'my-vibe-coded-app' });

appStorage.setItem('theme', 'dark'); // stored as "my-vibe-coded-app:theme"
appStorage.getItem('theme'); // 'dark'

localStorage.getItem('theme'); // null

// clear() only removes keys within the namespace
appStorage.clear();
```

### Subscribe to changes

Subscribe to a key to update other parts of the page when its storage entry changes. Other GreatStorage instances sharing the same backend and fully prefixed key notify the same listeners, even if those instances never subscribe themselves.

```ts
const preferences = createStorage({ prefix: 'app' });

function applyTheme() {
  document.documentElement.dataset.theme = preferences.getItem<string>('theme') ?? 'system';
}

const unsubscribe = preferences.subscribe('theme', (change) => {
  console.log(change.key, change.type, change.source);
  // 'theme', 'set' | 'remove' | 'expire', 'local' | 'external'
  applyTheme();
});

applyTheme(); // Subscribing does not invoke the listener immediately.

const writer = createStorage({ prefix: 'app' });
writer.setItem('theme', 'dark'); // Notifies this page synchronously.

unsubscribe(); // Safe to call again; each subscription is independent.
```

Tabs sharing `localStorage` receive changes asynchronously through browser storage events. `sessionStorage` remains scoped to its tab; memory and custom backends support same-page notifications between instances sharing the exact backend object.

Events describe storage changes, without carrying old/new values. Read the current value using `getItem()`, optionally with a schema. It may reflect a later write by the time you read it. Expiration stays lazy: only cleanup through `getItem()` or `clearExpired()` emits `expire`; passing the expiry time alone does not notify listeners.

### Check, remove, and clear

The usual housekeeping. Someone has to take out the trash.

```ts
storage.has('user'); // true
storage.removeItem('user');
storage.has('user'); // false

storage.clear(); // remove all entries written by `greatstorage`
storage.clearExpired(); // remove only expired entries
```

### Type-safe access

TypeScript can't read `localStorage` at compile time (yet), but you can at least pretend your data is typed.

```ts
interface User {
  name: string;
  age: number;
}

const user = storage.getItem<User>('user');
// user is typed as User | null

storage.getOrInit<User>('user', () => ({ name: 'Alice', age: 30 }));

storage.updateItem<User>('user', (current) => ({
  ...current!,
  age: current!.age + 1,
}));
```

However, the true safe way is to validate with a [schema during read](#schema-validation).

### Schema validation

Trust no one — especially since browser storage is open to tampering by users. Validate with any libraries that support [Standard Schema](https://github.com/standard-schema/standard-schema), as long as validation is synchronous.

```ts
import { z } from 'zod';

const UserSchema = z.object({ name: z.string(), age: z.number() });

// Returns typed value if valid, null if validation fails
const user = storage.getItem('user', { schema: UserSchema });
```

### Not just `localStorage`

Pass any `Storage`-compatible backend. Use `sessionStorage` for tab-scoped data, or `createMemoryStorage()` for tests and server-side rendering.

```ts
import { createStorage, createMemoryStorage } from 'greatstorage';

const storage = createStorage({
  storage: typeof window === 'undefined' ? createMemoryStorage() : undefined,
});
```

### Custom serializer

Don't like devalue? Bring your own `stringify`/`parse` and we won't judge. Much.

```ts
import superjson from 'superjson';

const storage = createStorage({
  serializer: { stringify: superjson.stringify, parse: superjson.parse },
});
```

If you provide your own serializer and want to keep `devalue` out of your bundle entirely, import from `greatstorage/core` instead. The only difference is that `serializer` is required.

```ts
import { createStorage } from 'greatstorage/core';
import superjson from 'superjson';

const storage = createStorage({
  serializer: { stringify: superjson.stringify, parse: superjson.parse },
});
```

### Additional APIs

Because `getItem` and `setItem` weren't enough, here are some bonus methods you didn't know you needed.

#### `storage.getOrInit()`

Get the value if it exists, or writes to storage if it doesn't. Either way, you're getting something back.

```ts
const prefs = storage.getOrInit('prefs', () => ({
  theme: 'light',
  lang: 'en',
}));
```

#### `storage.updateItem()`

Read-modify-write in one call. Three separate statements was apparently too much work even when AI is writing all the code.

```ts
storage.updateItem('count', (current) => (current ?? 0) + 1);
```

## API

### `createStorage(options?: CreateStorageOptions): GreatStorage`

Creates a new storage instance. All options are optional.

| Option       | Type         | Default        | Description                                            |
| ------------ | ------------ | -------------- | ------------------------------------------------------ |
| `prefix`     | `string`     | —              | Key prefix for namespacing                             |
| `separator`  | `string`     | `":"`          | Separator between prefix and key                       |
| `storage`    | `Storage`    | `localStorage` | Underlying Storage backend                             |
| `serializer` | `Serializer` | `devalue`      | Custom serializer with `stringify` and `parse` methods |

Also available from `greatstorage/core` where `serializer` is **required** and `devalue` is not bundled. See [Custom serializer](#custom-serializer).

Returns a `GreatStorage` instance, that has the same interface as [`Storage`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API), with additional APIs.

### `GreatStorage` instance

A `GreatStorage` instance with the following methods:

#### `storage.subscribe(key: string, listener: StorageListener): () => void`

Subscribes to one key relative to the instance's prefix. Returns an idempotent unsubscribe function and does not call the listener immediately. Both package entry points export these types:

```ts
interface StorageChange {
  readonly key: string;
  readonly type: 'set' | 'remove' | 'expire';
  readonly source: 'local' | 'external';
}

type StorageListener = (change: StorageChange) => void;
```

| Trigger                                         | Event                                   |
| ----------------------------------------------- | --------------------------------------- |
| `setItem()`, including writes through helpers   | `set`, `local`                          |
| `removeItem()`                                  | `remove`, `local`                       |
| `clear()`                                       | `remove` per affected key, `local`      |
| Cleanup through `getItem()` or `clearExpired()` | `expire`, `local`                       |
| Write or deletion observed from another tab     | `set` or `remove`, `external`           |
| Native storage clear observed from another tab  | `remove` per subscribed key, `external` |

Identical serialized writes (including expiry metadata), missing-key removals, and failed mutations do not notify listeners. Changing only expiry metadata still counts as a write. External deletions are always `remove`, since the browser cannot identify expiration cleanup or a namespace clear as their cause. Matching external writes can notify even when `getItem()` returns `null` for invalid or foreign data.

Local notifications run after the mutation completes. Reentrant writes append their notifications to a FIFO queue instead of interrupting the current delivery. Bulk removals finish before notifications run; if a removal fails partway, completed removals still notify and the storage error propagates. Unsubscribing suppresses pending callbacks for that subscription. Subscriptions added during delivery do not receive already queued events.

Listener exceptions are reported through `globalThis.reportError`, or `console.error` where unavailable, without interrupting other listeners or making a completed write throw. Browser listeners are attached lazily and removed after the backend's last unsubscribe.

#### `storage.getItem<T = unknown>(key: string): T | null`

Retrieves and deserializes a value. Returns `null` if the key is missing or expired. If the entry is expired, `getItem()` removes it from storage.

#### `storage.getItem<T>(key: string, options: { schema: StandardSchema }): T | null`

Retrieves and deserializes a value. Returns `null` if the key is missing, expired, or fails [schema validation](https://github.com/standard-schema/standard-schema).

If the entry is expired, `getItem()` removes it from storage.

Options:

| Option   | Type             | Description                                                     |
| -------- | ---------------- | --------------------------------------------------------------- |
| `schema` | `StandardSchema` | Validate the value during read. Async schemas are not supported |

#### `storage.setItem<T = unknown>(key: string, value: T, options?: StorageOptions): void`

Serializes and stores a value. Options:

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

#### `storage.getOrInit<T>(key: string, factory: () => T, options?: StorageOptions): T`

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

#### `storage.updateItem<T = unknown>(key: string, updater: (value: T | null) => T, options?: StorageOptions): T`

Calls `updater(currentValue)` where `currentValue` is the existing value (or `null`), stores the result, and returns it.

Options:

| Option      | Type             | Description                  |
| ----------- | ---------------- | ---------------------------- |
| `ttl`       | `number`         | Time-to-live in milliseconds |
| `expiresAt` | `Date \| number` | Absolute expiration time     |

`ttl` and `expiresAt` cannot be used together.

#### `storage.removeItem(key: string): void`

Removes a single key from the current namespace.

#### `storage.has(key: string): boolean`

Returns `true` if the key exists and is not expired. Expired entries are treated as missing and are not removed by `has()`.

#### `storage.key(index: number): string | null`

Returns the key at the given zero-based index among non-expired entries, or `null` if the index is out of bounds. Expired entries are skipped but not removed.

#### `storage.clear(): void`

Removes all entries written by `greatstorage` in the current namespace.

Entries outside the namespace and values not written by `greatstorage` are left untouched.

#### `storage.clearExpired(): void`

Removes only expired entries in the current namespace.

#### `storage.length: number`

The number of non-expired entries in the current namespace.

Expired entries are excluded from the count but not removed unless read via `getItem()` or swept with `clearExpired()`.

### `createMemoryStorage(): Storage`

Returns an in-memory `Storage` implementation. Useful for tests or server-side usage.

## How it works (longer version)

`greatstorage` is intentionally small. Under the hood, it's a thin wrapper around a `Storage` instance (e.g. `localStorage` / `sessionStorage`) that serializes your value together with a bit of metadata, then gives you a nicer API for reading it back safely.

### Internal entry format

Each stored value is wrapped in an internal envelope before being written to storage. That envelope includes a marker, a format version, your actual value, and an optional expiry timestamp.

This is what lets `greatstorage` tell its own entries apart from random keys already sitting in `localStorage`, attach TTL metadata without changing your value shape, and leave room to evolve the format later without pretending raw strings are part of the contract.

### Serialization by default, not by accident

By default, `greatstorage` uses [`devalue`](https://github.com/sveltejs/devalue) instead of `JSON.stringify()`. The point is not novelty. It's that JSON quietly loses or mangles useful JavaScript values like `Set`, `Map`, `Date`, `RegExp`, `BigInt`, `undefined`, `NaN`, and circular references.

The serializer is configurable on purpose. If you want `superjson`, or plain JSON for a more constrained setup, you can swap in your own `stringify` and `parse` methods and keep the rest of the API unchanged. If you bring your own serializer, import from `greatstorage/core` to keep `devalue` out of your bundle entirely.

### Expiration is lazy on read

TTL support is implemented as metadata on the entry, not as a background cleanup job. When you call `getItem()`, expired entries are treated as missing and removed immediately. `has()`, `key()`, and `length` also treat expired entries as missing, but they do not mutate storage.

That split is deliberate. Reads that already need the value can pay the cleanup cost, while bookkeeping-style operations stay predictable and side-effect free. If you want to proactively sweep old entries, `clearExpired()` is the explicit escape hatch.

### Namespaces stay in their lane

When you pass a `prefix`, `greatstorage` stores keys as `prefix + separator + key`. That isolates one logical namespace from another without requiring a separate storage backend.

It also means `clear()` only removes `greatstorage` entries in the current namespace. Keys written by other code, or values that were never written by `greatstorage` in the first place, are ignored rather than parsed opportunistically and guessed at.

### Why a factory, not a class

`createStorage()` returns a plain object built from a closure instead of an instance of a class. That keeps helper functions and configuration genuinely private, avoids `this` binding nonsense when methods are destructured, and makes the result easy to mock in tests.

It also matches the library's actual shape better: you're configuring a storage adapter around any `Storage`-compatible backend, whether that's `localStorage`, `sessionStorage`, or the in-memory implementation.

### Why validation happens on read

Schema validation happens when values come back out of storage, not when they go in. That's the trust boundary that matters. Browser storage is user-tamperable, and even valid data at write time can become invalid later if your schema changes.

So `getItem({ schema })` validates the retrieved value right before your app uses it. If validation fails, you get `null`. If the schema is async, `greatstorage` rejects it immediately rather than hiding asynchronous behavior behind a synchronous storage API.

## Caveats

- **Same-page writes must go through GreatStorage to notify**: Direct backend writes do not emit same-page notifications. Cross-tab browser events are still observed. Coordination is limited to instances sharing one loaded library runtime; separately bundled copies and mixed ESM/CJS runtimes do not share a registry.
- **Subscriptions are not React snapshots**: `getItem()` still returns freshly deserialized objects and can remove expired entries. A future React adapter will need a cached, side-effect-free snapshot read; this release does not include a React hook or snapshot API.
- **Still synchronous storage**: This wraps `localStorage`-style APIs, so reads and writes are still synchronous and still subject to browser storage quotas.
- **Changing serializers can strand old entries**: `getItem()` has a JSON fallback, but enumeration-based APIs like `clear()`, `clearExpired()`, `key()`, and `length` depend on the current serializer being able to parse old values. If you ever need to change serializers, we recommend changing the `prefix` and using a new namespace.
- **Expired entries are cleaned up lazily**: Expired data is hidden from reads immediately, but it may still occupy storage until `getItem()` touches it or `clearExpired()` is called.
- **`null` means several things**: `getItem()` returns `null` for missing keys, expired entries, foreign values not written by `greatstorage`, parse failures, and schema validation failures.
- **Stored `null` and missing keys look the same**: If that distinction matters, pair `getItem()` with `has()`.
- **Existing raw `localStorage` values are invisible**: This library only reads entries with its internal marker, so migrating older plain-string or plain-JSON data requires explicit migration code. You can use `getOrInit()` for this purpose, specifying a `factory` function that reads from the existing `localStorage` key.
- **No atomic updates across tabs or callers**: `getOrInit()` and `updateItem()` are read-modify-write helpers, not transactional operations.
- **Schema validation is sync-only and non-destructive**: Async schemas throw, and invalid stored values return `null` without being removed automatically.

## See also

- [store2](https://github.com/nbubna/store2) by Nathan Bubna: feature-rich `localStorage` wrapper with namespacing and plugins
- [store.js](https://github.com/marcuswestin/store.js) by Marcus Westin: cross-browser `localStorage` wrapper with fallback plugins
- [unstorage](https://github.com/unjs/unstorage) by UnJS: universal key-value storage with pluggable drivers (memory, filesystem, Redis, etc.)
- [storage-box](https://github.com/shahradelahi/storage-box) by Shahrad Elahi: simple `localStorage` wrapper with TTL support
- [lscache](https://github.com/pamelafox/lscache) by Pamela Fox: `localStorage` wrapper with memcached-inspired expiration

## Development

This project uses [Vite+](https://viteplus.dev/guide/) with the Node.js version in
`.node-version` and the package manager declared in `package.json`.

```sh
vp install
vp check
vp test
vp pack
```

Use `vp pack` or `vp run build` to build this library, including ESM, CJS, and
TypeScript declarations. `vp build` runs Vite's application build and expects an
HTML entry point. Formatting, linting, and packaging options live in `vite.config.ts`.

## License

MIT
