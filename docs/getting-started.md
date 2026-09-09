---
title: 'Getting started'
description: 'Install ultrastorage, create a shared instance, and choose the right entry point.'
---

## Installation

```sh
npm install ultrastorage
```

## Create a shared instance

Store and retrieve objects without the `JSON.stringify` dance. You're welcome.

```ts
// lib/storage.ts
import { createStorage } from 'ultrastorage';

// Create an app-wide singleton instance.
export const storage = createStorage();
```

```ts
// app.ts
import { storage } from './lib/storage';

storage.setItem('user', { name: 'Alice', age: 30 });
storage.getItem('user'); // { name: 'Alice', age: 30 }
```

## Choose an entry point

| Import               | Use it for                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `ultrastorage`       | Default devalue serialization, rich types, and all storage methods. |
| `ultrastorage/core`  | Your own serializer, with no bundled devalue.                       |
| `ultrastorage/react` | `useStorage` and `createStorageHook` for React 18 and 19.           |

Create storage instances outside components and reuse them throughout your app. Construction is safe on the server because default localStorage access is deferred until the first operation. Ordinary reads and writes still require an available backend; use [memory storage](/guides/backends) for server operations.

## Next steps

- [Read, write, and update values](/guides/values).
- [Respond to storage changes](/guides/subscriptions).
- [Connect React components](/react).
- [Understand limitations](/reference/caveats).
