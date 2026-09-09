import type { StorageChange, StorageListener } from './types';

interface Subscription {
  key: string;
  listener: StorageListener;
  active: boolean;
}

interface SubscriptionGroup {
  keys: Map<string, Set<Subscription>>;
  detach: () => void;
}

const groups = new WeakMap<Storage, SubscriptionGroup>();
const pending: { subscription: Subscription; change: StorageChange }[] = [];
let batchDepth = 0;
let delivering = false;

function reportListenerError(error: unknown): void {
  try {
    if (typeof globalThis.reportError === 'function') {
      globalThis.reportError(error);
    } else {
      console.error(error);
    }
  } catch {
    // Even a failing error reporter must not turn a completed write into a failure.
  }
}

function flush(): void {
  if (batchDepth > 0 || delivering) {
    return;
  }

  delivering = true;
  try {
    // Reentrant mutations append to this queue instead of interrupting delivery.
    for (let index = 0; index < pending.length; index++) {
      const { subscription, change } = pending[index]!;
      if (subscription.active) {
        try {
          const { listener } = subscription;
          listener(change);
        } catch (error) {
          reportListenerError(error);
        }
      }
    }
  } finally {
    pending.length = 0;
    delivering = false;
  }
}

export function batchNotifications(action: () => void): void {
  batchDepth++;
  try {
    action();
  } finally {
    batchDepth--;
    flush();
  }
}

export function hasSubscribers(storage: Storage, rawKey: string): boolean {
  return groups.get(storage)?.keys.has(rawKey) ?? false;
}

export function notify(
  storage: Storage,
  rawKey: string,
  type: StorageChange['type'],
  source: StorageChange['source'] = 'local',
): void {
  const subscriptions = groups.get(storage)?.keys.get(rawKey);
  if (!subscriptions) {
    return;
  }

  for (const subscription of subscriptions) {
    pending.push({
      subscription,
      change: Object.freeze({ key: subscription.key, type, source }),
    });
  }
  flush();
}

export function subscribe(
  storage: Storage,
  rawKey: string,
  key: string,
  listener: StorageListener,
): () => void {
  let group = groups.get(storage);
  if (!group) {
    group = { keys: new Map(), detach: () => {} };

    if (typeof window !== 'undefined') {
      const target = window;
      const keys = group.keys;
      const onStorage = (event: StorageEvent): void => {
        if (event.storageArea !== storage) {
          return;
        }

        if (event.key === null) {
          batchNotifications(() => {
            for (const subscribedKey of keys.keys()) {
              notify(storage, subscribedKey, 'remove', 'external');
            }
          });
        } else if (event.oldValue !== event.newValue) {
          notify(storage, event.key, event.newValue === null ? 'remove' : 'set', 'external');
        }
      };

      target.addEventListener('storage', onStorage);
      group.detach = () => target.removeEventListener('storage', onStorage);
    }

    groups.set(storage, group);
  }

  let subscriptions = group.keys.get(rawKey);
  if (!subscriptions) {
    subscriptions = new Set();
    group.keys.set(rawKey, subscriptions);
  }

  const subscription: Subscription = { key, listener, active: true };
  subscriptions.add(subscription);

  return () => {
    if (!subscription.active) {
      return;
    }
    subscription.active = false;
    subscriptions.delete(subscription);
    if (subscriptions.size === 0) {
      group.keys.delete(rawKey);
    }
    if (group.keys.size === 0) {
      group.detach();
      groups.delete(storage);
    }
  };
}
