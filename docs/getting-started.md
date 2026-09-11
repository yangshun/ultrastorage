---
title: 'Getting started'
description: 'Install ultrastorage, create a shared instance, and choose the right entry point.'
---

## Installation

```sh
npm install ultrastorage
```

## Create a shared instance

`createStorage()` returns a `Storage`-compatible object with familiar methods such as `getItem()`,
`setItem()`, and `removeItem()`. For everyday reads and writes, you can replace `localStorage` with
your shared instance.

Creating an instance lets you choose options such as a key prefix, where values are stored
(`localStorage`, `sessionStorage`, or memory), and how values are encoded.

Export it once and reuse it so those settings stay consistent across your app.

```ts lib/app-storage.ts
import { createStorage } from 'ultrastorage';

// Create an app-wide singleton instance.
export const appStorage = createStorage({
  // Optional, but highly recommended. The `theme` key will be stored as
  // `my-app:theme`, reducing the likelihood of collisions with third-party code.
  prefix: 'my-app',
});
```

```ts app.ts
import { appStorage } from './lib/app-storage';

appStorage.setItem('theme', 'dark');
appStorage.getItem('theme'); // 'dark'
appStorage.removeItem('theme');
```

That's enough to get started. The same API also supports rich values and expiration without the
`JSON.stringify` dance or manual cleanup.

```ts
appStorage.setItem('user', { name: 'Alice', age: 30 }, { ttl: 5_000 });
appStorage.getItem('user'); // { name: 'Alice', age: 30 }

// After five seconds:
appStorage.getItem('user'); // null
```

## Use with React

In a React 18 or 19 application, import `createStorageHook` from `ultrastorage/react` and bind it to
your shared `appStorage` instance.

Create the bound hook outside components; no provider or separate adapter package is required.

```ts lib/use-app-storage.ts
import { createStorageHook } from 'ultrastorage/react';
import { appStorage } from './app-storage';

export const useAppStorage = createStorageHook(appStorage);
```

Call `useAppStorage` in a component to read a key and update it. Components reading the same key stay in sync when you write through the hook or `appStorage`.

```tsx theme-picker.tsx
'use client';

import { useAppStorage } from './lib/use-app-storage';

export function ThemePicker() {
  const [theme, setTheme] = useAppStorage('theme', { defaultValue: 'light' });

  return (
    <button onClick={() => setTheme((previous) => (previous === 'light' ? 'dark' : 'light'))}>
      Theme: {theme}
    </button>
  );
}
```

`defaultValue` is displayed when the key is missing and is never automatically written. Use
`'use client'` in frameworks with React Server Components.

See the [React guide](/guides/react) for schemas, expiration, and server rendering, or the
[React API reference](/reference/react) for hook options.

## Choose an entry point

| Import               | Use it for                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `ultrastorage`       | Default devalue serialization, rich types, and all storage methods. |
| `ultrastorage/core`  | Your own serializer, with no bundled devalue.                       |
| `ultrastorage/react` | `useStorage` and `createStorageHook` for React 18 and 19.           |

Create storage instances outside components and reuse them throughout your app. Construction is safe
on the server because default localStorage access is deferred until the first operation.

Ordinary reads and writes still require `localStorage` or another configured `Storage` object to be
available; use [memory](/guides/destinations#save-values-in-memory) for server operations.

## Next steps

- [Read, write, and update values](/guides/values).
- [Respond to storage changes](/guides/subscriptions).
- [Connect React components](/guides/react).
- [Understand limitations](/guides/caveats).
