# greatstorage — Spec

## Problems

The native `localStorage` API has several pain points. This library solves the most common ones:

### 1. Strings only

`localStorage` only stores string values. Storing any other type requires manual `JSON.stringify()` on write and `JSON.parse()` on read. This is tedious, error-prone (parsing can throw), and easy to forget.

`greatstorage` uses [`devalue`](https://github.com/sveltejs/devalue) for serialization, which handles all JSON-compatible types plus rich types that `JSON.stringify` silently mangles or drops: `Set`, `Map`, `Date`, `RegExp`, `BigInt`, `NaN`, `Infinity`, `-0`, `undefined`, and circular references.

### 2. No expiration mechanism

`localStorage` has no built-in TTL or expiry. Data persists indefinitely until explicitly removed. Implementing expiration manually requires storing timestamps alongside values and checking them on every read.

`greatstorage` supports an optional `ttl` (time-to-live) in milliseconds or an absolute `expiresAt` timestamp. Expired items are treated as missing. `getItem()` removes expired entries on read, while `has()`, `key()`, and `length` ignore them until `clearExpired()` is called.

### 3. No namespacing

All keys in `localStorage` share a single flat namespace per origin. When multiple apps, modules, or versions write to the same storage, key collisions can silently overwrite data.

`greatstorage` supports an optional `prefix` that is transparently prepended to every key. Each namespace is fully isolated — `clear()` only removes keys within that namespace, not the entire storage.

## API

```ts
import { createMemoryStorage, createStorage } from 'greatstorage';
import { z } from 'zod';

const storage = createStorage(); // defaults to localStorage, no prefix

// Automatic serialization (primitives, objects, arrays)
storage.setItem('user', { name: 'Alice', age: 30 });
storage.getItem('user'); // → { name: 'Alice', age: 30 }

// Rich types (Set, Map, Date, RegExp)
storage.setItem('tags', new Set(['a', 'b']));
storage.getItem('tags'); // → Set {'a', 'b'}

storage.setItem('created', new Date('2025-01-15'));
storage.getItem('created'); // → Date 2025-01-15T00:00:00.000Z

// TTL support
storage.setItem('token', 'abc123', { ttl: 60_000 }); // expires in 60s
storage.getItem('token'); // → 'abc123' (or null if expired)

// Utility methods
storage.has('key'); // check existence (respects TTL)
storage.removeItem('key'); // remove a single key
storage.clear(); // remove all keys written by `greatstorage`
storage.clearExpired(); // proactively remove expired keys

// Namespacing
const appStorage = createStorage({ prefix: 'myapp', separator: ':' });
appStorage.setItem('user', 'Alice'); // stored as "myapp:user"
appStorage.getItem('user'); // → 'Alice'
appStorage.clear(); // only removes "myapp:*" keys

// Schema validation during read
const UserSchema = z.object({ name: z.string(), age: z.number() });
storage.getItem('user', { schema: UserSchema }); // typed value or null

// Use a different storage backend
const memoryStorage = createStorage({
  storage: createMemoryStorage(),
});

// Custom serializer (defaults to devalue)
const customStorage = createStorage({
  serializer: {
    stringify: JSON.stringify,
    parse: JSON.parse,
  },
});
```

## Subscriptions

`storage.subscribe(key, listener)` observes a single key relative to the instance prefix. It returns an idempotent unsubscribe function, and each registration is independent. Registration does not invoke the listener immediately.

```ts
const unsubscribe = storage.subscribe('theme', (change) => {
  // change: { key: string; type: 'set' | 'remove' | 'expire'; source: 'local' | 'external' }
  const currentTheme = storage.getItem<string>('theme');
  console.log(change.type, currentTheme);
});

storage.setItem('theme', 'dark');
unsubscribe();
```

- Both package entry points export `StorageChange` (readonly fields) and `StorageListener`. Events carry no old/new values; reads return current state, which may include a subsequent write.
- All instances sharing a backend object and fully prefixed key share notifications. Writers do not need to subscribe. Local delivery is synchronous after mutation; reentrant mutations queue notifications in FIFO order. Listener exceptions are reported and do not interrupt other listeners or fail completed writes.
- Successful writes emit `set`; existing-key removals emit `remove`. Helpers use their underlying read/write notifications. Identical serialized writes, missing-key removals, and failed mutations do not notify. Expiry metadata is part of equality.
- `clear()` emits `remove` per affected subscribed key. Bulk removals complete before delivery; a partial failure still notifies completed removals and preserves the storage error.
- Expiration remains lazy. Cleanup through `getItem()` and `clearExpired()` emits `expire`; the passage of time and bookkeeping reads do not. There are no expiration timers.
- Browser storage events are filtered by storage area and exact key. External writes and deletions emit `set` and `remove`; native clears invalidate all subscribed keys for that backend. External deletion causes cannot be distinguished. Events are never written back to storage.
- Subscriptions describe storage changes, not schema validity. A matching external write can notify even if the stored data is foreign or invalid. Direct backend writes in the same page are not observed.
- Listener state and browser listeners are created lazily and released on unsubscribe. Non-browser memory/custom backends do not require browser globals. Coordination across separate copies of the library or mixed ESM/CJS runtimes is not supported.
- Internal entry reads are separated from cleanup to support future snapshot work. Existing `getItem()` still returns fresh objects and removes expired data. Public snapshots, React integration, and namespace-wide subscriptions are deferred.

## Design decisions

- **Factory function (`createStorage`)** — Accepts an options object with `storage` (any `Storage`-compatible backend), `prefix`, `separator`, and `serializer`, making it testable and usable with `sessionStorage`, memory storage, or custom implementations.
- **Lazy expiration** — Expired items are treated as missing. `getItem()` removes them on read, while `has()`, `key()`, and `length` stay side-effect free.
- **Core key subscriptions** — A shared backend/key registry observes mutations from all instances, plus native browser storage events. Notifications are framework-independent and require no plugin or new runtime dependency.
- **Schema validation on read** — `getItem()` can validate retrieved values against any synchronous Standard Schema. Invalid values return `null`; async schemas are rejected.
- **No implicit reads of foreign values** — Values written directly to the underlying storage (not via `greatstorage`) are ignored rather than returned as raw strings or plain JSON.
- **Wrapper envelope** — Each value is stored as an internal envelope with metadata such as `__gs`, `version`, `value`, and `expiry`. The `__gs` marker distinguishes `greatstorage` entries from arbitrary objects.
- **Serialization via `devalue`** — Rich types are handled by [`devalue`](https://github.com/sveltejs/devalue) by default. Users can provide a custom `serializer` with `stringify` and `parse` methods (e.g. `superjson`, or plain `JSON` for minimal setups).
- **Scoped `clear()`** — When a prefix is set, `clear()` only removes keys belonging to that namespace rather than wiping the entire storage.
