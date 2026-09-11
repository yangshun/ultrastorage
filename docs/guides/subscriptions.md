---
title: 'Subscriptions'
description: 'React to key changes within a page, across instances, and in other browser tabs.'
---

Writing to storage does not automatically update the parts of your application that depend on it.

Subscriptions let you react when a specific key changes, whether through ultrastorage in the same
page or a browser storage event from another tab. Use them to keep displayed preferences and other
derived state in sync.

```ts lib/app-storage.ts
import { createStorage } from 'ultrastorage';

export const appStorage = createStorage({ prefix: 'app' });
```

Other ultrastorage instances using the same `Storage` object and fully prefixed key notify the same listeners, even if those instances never subscribe themselves.

```ts theme-sync.ts
import { appStorage } from './lib/app-storage';

function applyTheme() {
  document.documentElement.dataset.theme = appStorage.getItem<string>('theme') ?? 'system';
}

const unsubscribe = appStorage.subscribe('theme', (change) => {
  console.log(change.key); // 'theme'
  console.log(change.type); // 'set' | 'remove' | 'expire'
  console.log(change.source); // 'local' | 'external'
  applyTheme();
});

applyTheme(); // Subscribing does not invoke the listener immediately.
```

Another module can create its own instance with the same prefix and notify the subscriber above:

```ts theme-settings.ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'app' });
appStorage.setItem('theme', 'dark'); // Notifies this page synchronously.
```

When the subscriber is no longer needed, clean it up in the subscribing module:

```ts theme-sync.ts
unsubscribe(); // Safe to call again; each subscription is independent.
```

Tabs sharing `localStorage` receive changes asynchronously through browser storage events. `sessionStorage` remains scoped to its tab; in-memory and custom `Storage` objects support same-page notifications between instances using the exact same object.

Events describe storage changes, without carrying old/new values. Read the current value using
`getItem()`, optionally with a schema. It may reflect a later write by the time you read it.

Expiration stays lazy: only cleanup through `getItem()` or `clearExpired()` emits `expire`; passing
the expiry time alone does not notify listeners.

## Events and delivery

Subscribes to one key relative to the instance's prefix. Returns an idempotent unsubscribe function and does not call the listener immediately. The main and core entry points export these types:

```ts
interface StorageChange {
  readonly key: string;
  readonly type: 'set' | 'remove' | 'expire';
  readonly source: 'local' | 'external';
}

type StorageListener = (change: StorageChange) => void;
```

When subscribing with an array key, `change.key` is its opaque serialized string. Passing that value
to `getItem()` reads the changed entry.

```ts user-sync.ts
import { appStorage } from './lib/app-storage';

const key = ['users', userId] as const;

const unsubscribe = appStorage.subscribe(key, () => {
  const user = appStorage.getItem(key);
});

appStorage.setItem(['users', userId], user); // Notifies the subscription.
```

Equivalent array values share a subscription even when they are different array instances.

| Trigger                                         | Event                                   |
| ----------------------------------------------- | --------------------------------------- |
| `setItem()`, including writes through helpers   | `set`, `local`                          |
| `removeItem()`                                  | `remove`, `local`                       |
| `clear()`                                       | `remove` per affected key, `local`      |
| Cleanup through `getItem()` or `clearExpired()` | `expire`, `local`                       |
| Write or deletion observed from another tab     | `set` or `remove`, `external`           |
| Native storage clear observed from another tab  | `remove` per subscribed key, `external` |

Identical serialized writes (including expiry metadata), missing-key removals, and failed mutations
do not notify listeners. Changing only expiry metadata still counts as a write.

External deletions are always `remove`, since the browser cannot identify expiration cleanup or a
namespace clear as their cause. Matching external writes can notify even when `getItem()` returns
`null` for invalid or foreign data.

Local notifications run after the mutation completes. Reentrant writes append their notifications to
a FIFO queue instead of interrupting the current delivery. Bulk removals finish before notifications
run; if a removal fails partway, completed removals still notify and the storage error propagates.

Unsubscribing suppresses pending callbacks for that subscription. Subscriptions added during
delivery do not receive already queued events.

Listener exceptions are reported through `globalThis.reportError`, or `console.error` where
unavailable, without interrupting other listeners or making a completed write throw.

Browser listeners are attached lazily and removed after the last unsubscribe for that `Storage`
object.

## React components

Use the [React adapter](/guides/react) for cached, side-effect-free rendering instead of passing `getItem()` directly to React.
