---
title: 'Backends and serializers'
description: 'Use localStorage, sessionStorage, memory, or a custom serializer through the core entry point.'
---

## Storage backends

Pass any `Storage`-compatible backend. Use `sessionStorage` for tab-scoped data, or `createMemoryStorage()` for tests and server-side rendering.

```ts
import { createStorage, createMemoryStorage } from 'greatstorage';

const storage = createStorage({
  storage: typeof window === 'undefined' ? createMemoryStorage() : undefined,
});
```

## Memory storage

Returns an in-memory `Storage` implementation. Useful for tests or server-side usage.

```ts
const memory = createMemoryStorage();
const storage = createStorage({ storage: memory });
```

Use a separate memory backend for each server request when storing request-specific data. Separate instances must share the same backend object to receive each other's local notifications.

## Custom serialization

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

Changing serializers can make existing entries unreadable. Prefer a new prefix when changing formats; see the [migration caveats](/reference/caveats).
