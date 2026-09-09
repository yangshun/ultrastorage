---
title: 'Subscriptions'
description: 'React to key changes within a page, across instances, and in other browser tabs.'
---

```ts
import { createStorage } from 'ultrastorage';
```

Subscribe to a key to update other parts of the page when its storage entry changes. Other ultrastorage instances sharing the same backend and fully prefixed key notify the same listeners, even if those instances never subscribe themselves.

```ts
const preferences = createStorage({ prefix: 'app' });

function applyTheme() {
  document.documentElement.dataset.theme = preferences.getItem<string>('theme') ?? 'system';
}

const unsubscribe = preferences.subscribe('theme', (change) => {
  console.log(change.key, change.type, change.source);
  // 'theme', 'set' | 'remove' | 'expire', 'local' | 'external'
  applyTheme();
});

applyTheme(); // Subscribing does not invoke the listener immediately.

const writer = createStorage({ prefix: 'app' });
writer.setItem('theme', 'dark'); // Notifies this page synchronously.

unsubscribe(); // Safe to call again; each subscription is independent.
```

Tabs sharing `localStorage` receive changes asynchronously through browser storage events. `sessionStorage` remains scoped to its tab; memory and custom backends support same-page notifications between instances sharing the exact backend object.

Events describe storage changes, without carrying old/new values. Read the current value using `getItem()`, optionally with a schema. It may reflect a later write by the time you read it. Expiration stays lazy: only cleanup through `getItem()` or `clearExpired()` emits `expire`; passing the expiry time alone does not notify listeners.

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

| Trigger                                         | Event                                   |
| ----------------------------------------------- | --------------------------------------- |
| `setItem()`, including writes through helpers   | `set`, `local`                          |
| `removeItem()`                                  | `remove`, `local`                       |
| `clear()`                                       | `remove` per affected key, `local`      |
| Cleanup through `getItem()` or `clearExpired()` | `expire`, `local`                       |
| Write or deletion observed from another tab     | `set` or `remove`, `external`           |
| Native storage clear observed from another tab  | `remove` per subscribed key, `external` |

Identical serialized writes (including expiry metadata), missing-key removals, and failed mutations do not notify listeners. Changing only expiry metadata still counts as a write. External deletions are always `remove`, since the browser cannot identify expiration cleanup or a namespace clear as their cause. Matching external writes can notify even when `getItem()` returns `null` for invalid or foreign data.

Local notifications run after the mutation completes. Reentrant writes append their notifications to a FIFO queue instead of interrupting the current delivery. Bulk removals finish before notifications run; if a removal fails partway, completed removals still notify and the storage error propagates. Unsubscribing suppresses pending callbacks for that subscription. Subscriptions added during delivery do not receive already queued events.

Listener exceptions are reported through `globalThis.reportError`, or `console.error` where unavailable, without interrupting other listeners or making a completed write throw. Browser listeners are attached lazily and removed after the backend's last unsubscribe.

## React components

Use the [React adapter](/react) for cached, side-effect-free rendering instead of passing `getItem()` directly to React.
