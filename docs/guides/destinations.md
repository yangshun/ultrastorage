---
title: 'Destinations and serializers'
description: 'Choose where values are saved and how they are encoded.'
---

A destination is where ultrastorage saves values. Persistent browser data may belong in
`localStorage`, tab-specific data in `sessionStorage`, and test or server data in memory.

You may also need a particular serialization format. ultrastorage lets you configure both while
keeping the same API.

## Choose a destination

Pass `localStorage`, `sessionStorage`, or any object that implements `Storage` through the
`storage` option. Use `createMemoryStorage()` for tests and server-side rendering.

```ts
import { createStorage, createMemoryStorage } from 'ultrastorage';

const appStorage = createStorage({
  prefix: 'acme',
  storage: typeof window === 'undefined' ? createMemoryStorage() : undefined,
});
```

## Save values in memory

`createMemoryStorage()` returns an in-memory `Storage` implementation for tests or server-side
usage.

```ts
const memory = createMemoryStorage();
const appStorage = createStorage({ prefix: 'acme', storage: memory });
```

Use a separate in-memory object for each server request when saving request-specific data. Separate
instances must use the same object through the `storage` option to receive each other's local
notifications.

## Custom serialization

Don't like devalue? Bring your own `stringify`/`parse` and we won't judge. Much.

```ts
import superjson from 'superjson';

const appStorage = createStorage({
  prefix: 'acme',
  serializer: { stringify: superjson.stringify, parse: superjson.parse },
});
```

If you provide your own serializer and want to keep `devalue` out of your bundle entirely, import
from `ultrastorage/core` instead. The only difference is that `serializer` is required.

```ts
import { createStorage } from 'ultrastorage/core';
import superjson from 'superjson';

const appStorage = createStorage({
  prefix: 'acme',
  serializer: { stringify: superjson.stringify, parse: superjson.parse },
});
```

Changing serializers can make existing entries unreadable. Prefer a new prefix when changing
formats; see the [migration caveats](/guides/caveats).
