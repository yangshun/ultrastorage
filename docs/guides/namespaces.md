---
title: 'Namespaces'
description: 'Isolate storage keys with prefixes and configurable separators.'
---

Applications and libraries on the same origin share `localStorage`, making common keys such as `user`
or `theme` easy to overwrite accidentally.

Namespaces give your keys a configurable prefix and keep operations such as `clear()` scoped to
that namespace. This lets different parts of your application manage their data independently.

```ts
import { createStorage } from 'ultrastorage';
```

```ts
const appStorage = createStorage({ prefix: 'acme' });

appStorage.setItem('theme', 'dark'); // stored as "acme:theme"
appStorage.getItem('theme'); // 'dark'

localStorage.getItem('theme'); // null

// clear() only removes keys within the namespace
appStorage.clear();
```

## Custom separators

```ts
const appStorage = createStorage({ prefix: 'acme', separator: '/' });
appStorage.setItem('theme', 'dark'); // stored key: acme/theme
```

The separator is only placed between the namespace prefix and the key.

Keys passed to methods and returned in subscription events are relative to the subscribing
instance's prefix. Instances share notifications only when they use the exact same `Storage` object
and their fully prefixed keys match.

Use compatible serializers when multiple instances read the same data.
