import { decodeEntry, isStorageEntry, validateEntry } from './entry';
import type { StorageEntryEnvelope } from './entry';
import { deserializeStorageKey, serializeStorageKey } from './keys';
import { registerSnapshotAccess } from './snapshots';
import { batchNotifications, hasSubscribers, notify, subscribe } from './subscriptions';
import type {
  CoreStorageOptions,
  GetOptions,
  UltraStorage,
  StorageChange,
  StorageKey,
  StorageListener,
  StorageOptions,
} from './types';

declare const process: { env: { NODE_ENV?: string } };

const ENTRY_MARKER = '__us';
const warned = process.env.NODE_ENV !== 'production' ? new Set<string>() : undefined;

// Implemented as a closure factory rather than a class so that internal helpers
// (forEachEntry, removeEntries, serializer, etc.) are truly private, destructuring
// works without `this`-binding issues, and the return type is a plain object that
// is easy to mock in tests.
export function createStorage(options: CoreStorageOptions): UltraStorage {
  let backend = options.storage;
  function getBackend(): Storage {
    return (backend ??= localStorage);
  }
  const separator = options.separator ?? ':';
  const prefix = options.prefix ? options.prefix + separator : '';
  const serializer = options.serializer;

  function prefixedKey(key: StorageKey): string {
    return prefix + serializeStorageKey(key);
  }

  // Decoding is shared with snapshot readers; expiration cleanup belongs only
  // to the public read path below.
  function readEntry(key: StorageKey): StorageEntryEnvelope | null {
    return decodeEntry(getBackend().getItem(prefixedKey(key)), serializer);
  }

  function getItem<T = unknown>(key: StorageKey, options?: GetOptions<T>): T | null {
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

  function setItem<T = unknown>(key: StorageKey, value: T, options?: StorageOptions): void {
    const expiry = resolveExpiry(options);
    const serializedKey = serializeStorageKey(key);

    if (process.env.NODE_ENV !== 'production') {
      if (value === null && !warned!.has(`null:${serializedKey}`)) {
        warned!.add(`null:${serializedKey}`);
        console.warn(
          `[ultrastorage] Storing \`null\` for key "${serializedKey}". This is indistinguishable from a missing key when read back with \`getItem()\`. If you need to distinguish between "set to null" and "not set", consider using a sentinel value or pairing \`getItem()\` with \`has()\`.`,
        );
      }

      if (expiry != null && Date.now() > expiry && !warned!.has(`expiry:${serializedKey}`)) {
        warned!.add(`expiry:${serializedKey}`);
        console.warn(
          `[ultrastorage] Key "${serializedKey}" is being stored with an expiry already in the past. It will be treated as expired immediately on the next read.`,
        );
      }
    }

    const entry: StorageEntryEnvelope = {
      [ENTRY_MARKER]: true as const,
      version: 1, // Useful for future-proofing in case we need to change the storage format
      value,
      expiry,
    };
    const rawKey = prefix + serializedKey;
    const raw = serializer.stringify(entry);
    const observed = hasSubscribers(getBackend(), rawKey);
    const previous = observed ? getBackend().getItem(rawKey) : null;
    getBackend().setItem(rawKey, raw);
    if (observed && previous !== raw) {
      notify(getBackend(), rawKey, 'set');
    }
  }

  function getOrInit<T>(key: StorageKey, factory: () => T, options?: StorageOptions): T {
    const existing = getItem<T>(key);
    if (existing !== null) {
      return existing;
    }

    const value = factory();

    if (process.env.NODE_ENV !== 'production') {
      const serializedKey = serializeStorageKey(key);
      if (value === null && !warned!.has(`getOrInit:${serializedKey}`)) {
        warned!.add(`getOrInit:${serializedKey}`);
        console.warn(
          `[ultrastorage] \`getOrInit()\` factory for key "${serializedKey}" returned \`null\`. Since \`getItem()\` also returns \`null\` for missing keys, the factory will be called again on every \`getOrInit()\` call.`,
        );
      }
    }

    setItem(key, value, options);
    return value;
  }

  function updateItem<T = unknown>(
    key: StorageKey,
    updater: (value: T | null) => T,
    options?: StorageOptions,
  ): T {
    const existing = getItem<T>(key);
    const updated = updater(existing);
    setItem(key, updated, options);
    return updated;
  }

  function removeItem(key: StorageKey): void {
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
        // Not a ultrastorage entry, skip
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

  function has(key: StorageKey): boolean {
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

  function key(index: number): StorageKey | null {
    let count = 0;
    for (const [rawKey, entry] of entries()) {
      if (entry.expiry == null || Date.now() <= entry.expiry) {
        if (count === index) {
          return deserializeStorageKey(prefix ? rawKey.slice(prefix.length) : rawKey);
        }
        count++;
      }
    }
    return null;
  }

  function keys(): StorageKey[] {
    const now = Date.now();
    const result: StorageKey[] = [];
    for (const [rawKey, entry] of entries()) {
      if (entry.expiry == null || now <= entry.expiry) {
        result.push(deserializeStorageKey(prefix ? rawKey.slice(prefix.length) : rawKey));
      }
    }
    return result;
  }

  const api = {
    subscribe: (key: StorageKey, listener: StorageListener) => {
      const serializedKey = serializeStorageKey(key);
      return subscribe(getBackend(), prefix + serializedKey, serializedKey, listener);
    },
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
    keys,
    clear,
    clearExpired,
    has,
  } satisfies UltraStorage;

  registerSnapshotAccess(api, {
    readRaw: (key) => getBackend().getItem(prefixedKey(key)),
    serializer,
  });
  return api;
}
