---
title: 'Expiration'
description: 'Set a TTL or an absolute expiration time and understand lazy cleanup.'
---

Some data is only useful for a limited time: cached responses become stale, temporary preferences
should reset, and dismissed notices may need to reappear. `localStorage` has no built-in expiration.

ultrastorage lets you set a lifetime or an expiration date so expired values are treated as missing
when read.

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'acme' });
```

**Note**: Expired data behaves like a missing key. `getItem()` removes expired entries on read, while `has()`, `key()`, and `length` simply ignore them. Use `clearExpired()` to proactively sweep them.

```ts
// Expires in 60 seconds
appStorage.setItem('token', 'abc123', { ttl: 60_000 });

// Expires at a specific date
appStorage.setItem('session', { id: 1 }, { expiresAt: new Date('2025-12-31') });

// Expired items return null
appStorage.getItem('token'); // null (after 60s)
```

## Cleanup and notifications

Passing an expiration timestamp does not schedule a timer or notify subscribers. Cleanup through `getItem()` or `clearExpired()` emits an `expire` event. Bookkeeping reads (`has()`, `key()`, and `length`) exclude expired entries without deleting them.

`ttl` and `expiresAt` cannot be used together. Both accept finite millisecond values; `expiresAt`
also accepts a valid Date.

An entry expires when the current time is strictly greater than its expiry timestamp. A new write
without expiration options removes any previous expiration.

For React rendering, see [snapshots and expiration](/guides/react#snapshots-and-expiration).
