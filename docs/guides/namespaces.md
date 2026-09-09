---
title: 'Namespaces'
description: 'Isolate storage keys with prefixes and configurable separators.'
---

```ts
import { createStorage } from 'greatstorage';
```

Because your keys deserve their own personal space, away from whatever chaos other libraries left behind.

```ts
const appStorage = createStorage({ prefix: 'my-vibe-coded-app' });

appStorage.setItem('theme', 'dark'); // stored as "my-vibe-coded-app:theme"
appStorage.getItem('theme'); // 'dark'

localStorage.getItem('theme'); // null

// clear() only removes keys within the namespace
appStorage.clear();
```

## Custom separators

```ts
const preferences = createStorage({ prefix: 'preferences', separator: '/' });
preferences.setItem('theme', 'dark'); // backend key: preferences/theme
```

Keys passed to methods and returned in subscription events are relative to the subscribing instance's prefix. Instances share notifications only when their backend object and fully prefixed keys match. Use compatible serializers when multiple instances read the same data.
