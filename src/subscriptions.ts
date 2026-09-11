import { decodeEntry } from './entry';
import type { Serializer, StorageChange, StorageListener } from './types';

interface Subscription {
  key: string;
  listener: StorageListener;
  active: boolean;
  expiration?: { refresh: () => void; recheck: () => void; cancel: () => void };
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
    subscription.expiration?.refresh();
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
  expirationSerializer?: Serializer,
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
  if (expirationSerializer) {
    subscription.expiration = observeExpiration(
      storage,
      rawKey,
      subscription,
      expirationSerializer,
    );
    subscription.expiration.refresh();
  }

  const stopResumeChecks = subscription.expiration ? observeResume(subscription) : undefined;

  return () => {
    if (!subscription.active) {
      return;
    }
    subscription.active = false;
    subscription.expiration?.cancel();
    stopResumeChecks?.();
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

// A timer belongs to its subscription, including its serializer and notification history.
// Refreshes never mutate storage and never broadcast timer events to ordinary listeners.
function observeExpiration(
  storage: Storage,
  rawKey: string,
  subscription: Subscription,
  serializer: Serializer,
): { refresh: () => void; recheck: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previousRaw: string | null | undefined;
  let previousExpiry: number | null | undefined;
  let announced = false;

  function cancel(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function refresh(notifyExpired = false): void {
    cancel();
    if (!subscription.active) return;
    try {
      const raw = storage.getItem(rawKey);
      const expiry = decodeEntry(raw, serializer)?.expiry;
      if (raw !== previousRaw || expiry !== previousExpiry) {
        previousRaw = raw;
        previousExpiry = expiry;
        announced = false;
      }
      if (expiry == null || announced) return;
      const now = Date.now();
      if (notifyExpired && now > expiry) {
        announced = true;
        pending.push({
          subscription,
          change: Object.freeze({ key: subscription.key, type: 'expire', source: 'local' }),
        });
        flush();
        return;
      }
      // Entries are valid at the exact deadline. Chunk long delays to avoid overflow.
      const delay = Math.min(2_147_483_647, Math.max(1, Math.floor(expiry - now) + 1));
      timer = setTimeout(() => refresh(true), delay);
      (timer as unknown as { unref?: () => void }).unref?.();
    } catch (error) {
      // Do not turn a completed mutation into a failure or retry a broken backend in a loop.
      reportListenerError(error);
    }
  }

  return { refresh: () => refresh(), recheck: () => refresh(true), cancel };
}

// One pair of browser listeners across backends, retained only by reactive subscriptions.
const resumeSubscriptions = new Set<Subscription>();
let detachResumeListeners: (() => void) | undefined;

function observeResume(subscription: Subscription): (() => void) | undefined {
  if (typeof window === 'undefined') return;
  if (resumeSubscriptions.size === 0) {
    const target = window;
    const documentTarget = typeof document === 'undefined' ? undefined : document;
    const recheck = (): void => {
      batchNotifications(() => {
        for (const current of Array.from(resumeSubscriptions)) {
          current.expiration?.recheck();
        }
      });
    };
    const onVisibilityChange = (): void => {
      if (documentTarget?.visibilityState === 'visible') recheck();
    };
    target.addEventListener('focus', recheck);
    documentTarget?.addEventListener('visibilitychange', onVisibilityChange);
    detachResumeListeners = () => {
      target.removeEventListener('focus', recheck);
      documentTarget?.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }
  resumeSubscriptions.add(subscription);
  return () => {
    resumeSubscriptions.delete(subscription);
    if (resumeSubscriptions.size === 0) {
      detachResumeListeners?.();
      detachResumeListeners = undefined;
    }
  };
}
