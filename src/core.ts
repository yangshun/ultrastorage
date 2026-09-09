import { decodeEntry, isStorageEntry, validateEntry } from './entry';
import type { StorageEntryEnvelope } from './entry';
import { registerSnapshotAccess } from './snapshots';
import { batchNotifications, hasSubscribers, notify, subscribe } from './subscriptions';
import type {
  CoreStorageOptions,
  GetOptions,
  GreatStorage,
  StorageChange,
  StorageListener,
  StorageOptions,
} from './types';

declare const process: { env: { NODE_ENV?: string } };

const ENTRY_MARKER = '__gs';
const warned = process.env.NODE_ENV !== 'production' ? new Set<string>() : undefined;

// Implemented as a closure factory rather than a class so that internal helpers
// (forEachEntry, removeEntries, serializer, etc.) are truly private, destructuring
// works without `this`-binding issues, and the return type is a plain object that
// is easy to mock in tests.
export function createStorage(options: CoreStorageOptions): GreatStorage {
  let backend = options.storage;
  function getBackend(): Storage {
    return (backend ??= localStorage);
  }
  const separator = options.separator ?? ':';
  const prefix = options.prefix ? options.prefix + separator : '';
  const serializer = options.serializer;

  function prefixedKey(key: string): string {
    return prefix + key;
  }

  // Decoding is shared with snapshot readers; expiration cleanup belongs only
  // to the public read path below.
  function readEntry(key: string): StorageEntryEnvelope | null {
    return decodeEntry(getBackend().getItem(prefixedKey(key)), serializer);
  }

  function getItem<T = unknown>(key: string, options?: GetOptions<T>): T | null {
    const entry = readEntry(key);
    if (entry === null) {
      return null;
    }

    if (entry.expiry != null && Date.now() > entry.expiry) {
      removeStoredItem(prefixedKey(key), 'expire');
      return null;
    }

    return validateEntry<T>(entry, options?.schema);
  }

  function resolveExpiry(options?: StorageOptions): number | null {
    if (options?.ttl != null && options?.expiresAt != null) {
      throw new TypeError('Cannot specify both "ttl" and "expiresAt". Use one or the other.');
    }

    if (options?.ttl != null) {
      return Date.now() + options.ttl;
    }

    if (options?.expiresAt != null) {
      return options.expiresAt instanceof Date ? options.expiresAt.getTime() : options.expiresAt;
    }

    return null;
  }

  function setItem<T = unknown>(key: string, value: T, options?: StorageOptions): void {
    const expiry = resolveExpiry(options);

    if (process.env.NODE_ENV !== 'production') {
      if (value === null && !warned!.has(`null:${key}`)) {
        warned!.add(`null:${key}`);
        console.warn(
          `[greatstorage] Storing \`null\` for key "${key}". This is indistinguishable from a missing key when read back with \`getItem()\`. If you need to distinguish between "set to null" and "not set", consider using a sentinel value or pairing \`getItem()\` with \`has()\`.`,
        );
      }

      if (expiry != null && Date.now() > expiry && !warned!.has(`expiry:${key}`)) {
        warned!.add(`expiry:${key}`);
        console.warn(
          `[greatstorage] Key "${key}" is being stored with an expiry already in the past. It will be treated as expired immediately on the next read.`,
        );
      }
    }

    const entry: StorageEntryEnvelope = {
      [ENTRY_MARKER]: true as const,
      version: 1, // Useful for future-proofing in case we need to change the storage format
      value,
      expiry,
    };
    const rawKey = prefixedKey(key);
    const raw = serializer.stringify(entry);
    const observed = hasSubscribers(getBackend(), rawKey);
    const previous = observed ? getBackend().getItem(rawKey) : null;
    getBackend().setItem(rawKey, raw);
    if (observed && previous !== raw) {
      notify(getBackend(), rawKey, 'set');
    }
  }

  function getOrInit<T>(key: string, factory: () => T, options?: StorageOptions): T {
    const existing = getItem<T>(key);
    if (existing !== null) {
      return existing;
    }

    const value = factory();

    if (process.env.NODE_ENV !== 'production') {
      if (value === null && !warned!.has(`getOrInit:${key}`)) {
        warned!.add(`getOrInit:${key}`);
        console.warn(
          `[greatstorage] \`getOrInit()\` factory for key "${key}" returned \`null\`. Since \`getItem()\` also returns \`null\` for missing keys, the factory will be called again on every \`getOrInit()\` call.`,
        );
      }
    }

    setItem(key, value, options);
    return value;
  }

  function updateItem<T = unknown>(
    key: string,
    updater: (value: T | null) => T,
    options?: StorageOptions,
  ): T {
    const existing = getItem<T>(key);
    const updated = updater(existing);
    setItem(key, updated, options);
    return updated;
  }

  function removeItem(key: string): void {
    removeStoredItem(prefixedKey(key), 'remove');
  }

  function removeStoredItem(rawKey: string, type: StorageChange['type']): void {
    const previous = hasSubscribers(getBackend(), rawKey) ? getBackend().getItem(rawKey) : null;
    getBackend().removeItem(rawKey);
    if (previous !== null) {
      notify(getBackend(), rawKey, type);
    }
  }

  function* entries(): Generator<[key: string, entry: StorageEntryEnvelope]> {
    for (let i = 0; i < getBackend().length; i++) {
      const key = getBackend().key(i);
      if (key === null) {
        continue;
      }

      if (prefix && !key.startsWith(prefix)) {
        continue;
      }

      const raw = getBackend().getItem(key);
      if (raw === null) {
        continue;
      }

      try {
        const entry = serializer.parse(raw);
        if (isStorageEntry(entry)) {
          yield [key, entry];
        }
      } catch {
        // Not a greatstorage entry, skip
      }
    }
  }

  function removeEntries(
    predicate: (entry: StorageEntryEnvelope) => boolean,
    type: 'remove' | 'expire',
  ): void {
    const keysToRemove: string[] = [];

    for (const [key, entry] of entries()) {
      if (predicate(entry)) {
        keysToRemove.push(key);
      }
    }

    batchNotifications(() => {
      for (const key of keysToRemove) {
        removeStoredItem(key, type);
      }
    });
  }

  function clear(): void {
    removeEntries(() => true, 'remove');
  }

  function clearExpired(): void {
    removeEntries((entry) => entry.expiry != null && Date.now() > entry.expiry, 'expire');
  }

  function has(key: string): boolean {
    const raw = getBackend().getItem(prefixedKey(key));

    if (raw === null) {
      return false;
    }

    try {
      const entry = serializer.parse(raw);
      if (!isStorageEntry(entry)) {
        return false;
      }

      if (entry.expiry != null && Date.now() > entry.expiry) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  function key(index: number): string | null {
    let count = 0;
    for (const [rawKey, entry] of entries()) {
      if (entry.expiry == null || Date.now() <= entry.expiry) {
        if (count === index) {
          return prefix ? rawKey.slice(prefix.length) : rawKey;
        }
        count++;
      }
    }
    return null;
  }

  const api = {
    subscribe: (key: string, listener: StorageListener) =>
      subscribe(getBackend(), prefixedKey(key), key, listener),
    get length() {
      let count = 0;
      for (const [, entry] of entries()) {
        if (entry.expiry == null || Date.now() <= entry.expiry) {
          count++;
        }
      }
      return count;
    },
    getItem,
    setItem,
    getOrInit,
    updateItem,
    removeItem,
    key,
    clear,
    clearExpired,
    has,
  } satisfies GreatStorage;

  registerSnapshotAccess(api, {
    readRaw: (key) => getBackend().getItem(prefixedKey(key)),
    serializer,
  });
  return api;
}
