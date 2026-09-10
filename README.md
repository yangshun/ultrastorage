# ultrastorage

Gives `localStorage` superpowers. Handles serialization of rich types, key expiration, namespacing, and schema validation — so you don't have to.

## Features

- **Store anything**: Stores `Set`, `Map`, `Date`, `RegExp`, `BigInt`, circular references, and more using [devalue](https://github.com/sveltejs/devalue)
- **TTL / expiration**: Set a `ttl` in milliseconds or an absolute `expiresAt` timestamp. Expired items are treated as missing, can be removed on `getItem()`, and can be swept with `clearExpired()`
- **Namespacing**: Isolate keys with a configurable `prefix` and `separator`
- **Subscriptions**: React to key changes within a page and across tabs sharing `localStorage`
- **React hooks**: Optional [`ultrastorage/react` adapter](docs/guides/react.md) with typed values, functional updates, and server rendering
- **Schema validation**: Validate retrieved values against any [Standard Schema](https://github.com/standard-schema/standard-schema) with synchronous validation (Zod, Valibot, ArkType, etc.)
- **Choose where values are saved**: Use `localStorage`, `sessionStorage`, any object that implements `Storage`, or the included in-memory implementation
- **ESM and CJS**: Tree-shakeable dual builds with full TypeScript types

## Installation

```sh
npm install ultrastorage
```

## How it works

Internally, every value is stored as an object rather than being written to the storage raw. That object carries the user `value`, an optional `expiry`, a `version`, and an internal `__us` marker. The marker is there so `ultrastorage` can reliably tell its own entries apart from unrelated keys already living in the same `Storage`. The version is there so the on-disk format can evolve later without guessing which shape an older entry used if this library ever needs to change the internal storage structure.

New writes use `__us`; existing entries marked with `__gs` remain fully supported without migration.

Refer to the [documentation](docs/resources/how-it-works.md) for more explanation regarding internals and design decisions.

## Usage

### Basic

Store and retrieve objects without the `JSON.stringify` dance. You're welcome.

```ts
// lib/app-storage.ts
import { createStorage } from 'ultrastorage';

// Create an app-wide singleton instance.
export const appStorage = createStorage({ prefix: 'my-app' });
```

```ts
// app.ts
import { appStorage } from './lib/app-storage';

appStorage.setItem('user', { name: 'Alice', age: 30 });
appStorage.getItem('user'); // { name: 'Alice', age: 30 }
```

### Store anything

Yes, `localStorage` can finally handle a `Set`, or any data type you throw at it. It only took the entire JavaScript ecosystem to get here.

Uses [devalue](https://github.com/sveltejs/devalue) by default, but you can bring your own serializer.

```ts
appStorage.setItem('tags', new Set(['a', 'b', 'c']));
appStorage.getItem('tags'); // Set {'a', 'b', 'c'}

appStorage.setItem('metadata', new Map([['key', 'value']]));
appStorage.getItem('metadata'); // Map {'key' => 'value'}

appStorage.setItem('date', new Date('2025-01-01'));
appStorage.getItem('date'); // Date 2025-01-01T00:00:00.000Z
```

### TTL / expiration

Store data temporarily. Like Snapchat, but for your storage keys.

**Note**: Expired data behaves like a missing key. `getItem()` removes expired entries on read, while `has()`, `key()`, and `length` simply ignore them. Use `clearExpired()` to proactively sweep them.

```ts
// Expires in 60 seconds
appStorage.setItem('token', 'abc123', { ttl: 60_000 });

// Expires at a specific date
appStorage.setItem('session', { id: 1 }, { expiresAt: new Date('2025-12-31') });

// Expired items return null
appStorage.getItem('token'); // null (after 60s)
```

### Namespacing

Because your keys deserve their own personal space, away from whatever chaos other libraries left behind.

```ts
const appStorage = createStorage({ prefix: 'my-app' });

appStorage.setItem('theme', 'dark'); // stored as "my-app:theme"
appStorage.getItem('theme'); // 'dark'

localStorage.getItem('theme'); // null

// clear() only removes keys within the namespace
appStorage.clear();
```

### Subscribe to changes

Subscribe to a key to update other parts of the page when its storage entry changes. Other ultrastorage instances using the same `Storage` object and fully prefixed key notify the same listeners, even if those instances never subscribe themselves.

```ts
const appStorage = createStorage({ prefix: 'app' });

function applyTheme() {
  document.documentElement.dataset.theme = appStorage.getItem<string>('theme') ?? 'system';
}

const unsubscribe = appStorage.subscribe('theme', (change) => {
  console.log(change.key, change.type, change.source);
  // 'theme', 'set' | 'remove' | 'expire', 'local' | 'external'
  applyTheme();
});

applyTheme(); // Subscribing does not invoke the listener immediately.
```

Another module can create its own instance with the same prefix and notify the subscriber above:

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'app' });
appStorage.setItem('theme', 'dark'); // Notifies this page synchronously.
```

When the subscriber is no longer needed, clean it up in the subscribing module:

```ts
unsubscribe(); // Safe to call again; each subscription is independent.
```

Tabs sharing `localStorage` receive changes asynchronously through browser storage events. `sessionStorage` remains scoped to its tab; in-memory and custom `Storage` objects support same-page notifications between instances using the exact same object.

Events describe storage changes, without carrying old/new values. Read the current value using `getItem()`, optionally with a schema. It may reflect a later write by the time you read it. Expiration stays lazy: only cleanup through `getItem()` or `clearExpired()` emits `expire`; passing the expiry time alone does not notify listeners.

### Check, remove, and clear

The usual housekeeping. Someone has to take out the trash.

```ts
appStorage.has('user'); // true
appStorage.removeItem('user');
appStorage.has('user'); // false

appStorage.clear(); // remove all entries written by `ultrastorage`
appStorage.clearExpired(); // remove only expired entries
```

### Type-safe access

TypeScript can't read `localStorage` at compile time (yet), but you can at least pretend your data is typed.

```ts
interface User {
  name: string;
  age: number;
}

const user = appStorage.getItem<User>('user');
// user is typed as User | null

appStorage.getOrInit<User>('user', () => ({ name: 'Alice', age: 30 }));

appStorage.updateItem<User>('user', (current) => ({
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
const user = appStorage.getItem('user', { schema: UserSchema });
```

### Not just `localStorage`

Pass `localStorage`, `sessionStorage`, or any object that implements `Storage`. Use `createMemoryStorage()` for tests and server-side rendering.

```ts
import { createStorage, createMemoryStorage } from 'ultrastorage';

const appStorage = createStorage({
  prefix: 'my-app',
  storage: typeof window === 'undefined' ? createMemoryStorage() : undefined,
});
```

### Custom serializer

Don't like devalue? Bring your own `stringify`/`parse` and we won't judge. Much.

```ts
import superjson from 'superjson';

const appStorage = createStorage({
  prefix: 'my-app',
  serializer: { stringify: superjson.stringify, parse: superjson.parse },
});
```

If you provide your own serializer and want to keep `devalue` out of your bundle entirely, import from `ultrastorage/core` instead. The only difference is that `serializer` is required.

```ts
import { createStorage } from 'ultrastorage/core';
import superjson from 'superjson';

const appStorage = createStorage({
  prefix: 'my-app',
  serializer: { stringify: superjson.stringify, parse: superjson.parse },
});
```

### Additional APIs

Because `getItem` and `setItem` weren't enough, here are some bonus methods you didn't know you needed.

#### `appStorage.getOrInit()`

Get the value if it exists, or writes to storage if it doesn't. Either way, you're getting something back.

```ts
const prefs = appStorage.getOrInit('prefs', () => ({
  theme: 'light',
  lang: 'en',
}));
```

#### `appStorage.updateItem()`

Read-modify-write in one call. Three separate statements was apparently too much work even when AI is writing all the code.

```ts
appStorage.updateItem('count', (current) => (current ?? 0) + 1);
```

See the [documentation](docs/index.md) for the full API reference, React integration, and caveats.

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
vp test run
vp run test:coverage # enforces 100% runtime coverage
vp pack
```

Use `vp pack` or `vp run build` to build this library, including ESM, CJS, and
TypeScript declarations. `vp build` runs Vite's application build and expects an
HTML entry point. Formatting, linting, and packaging options live in `vite.config.ts`.

## License

MIT
