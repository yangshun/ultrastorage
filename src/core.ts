import { decodeEntry, isPromiseLike, validateEntry, validateValue } from './entry';
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

const ENTRY_MARKER = '__us';
const isProduction =
  (
    globalThis as typeof globalThis & {
      process?: { env?: { NODE_ENV?: string } };
    }
  ).process?.env?.NODE_ENV === 'production';
const warned = isProduction ? undefined : new Set<string>();

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

  if (!isProduction && options.prefix && separator && options.prefix.includes(separator)) {
    const warningKey = `prefix:${JSON.stringify([options.prefix, separator])}`;
    if (!warned!.has(warningKey)) {
      warned!.add(warningKey);
      console.warn(
        `[ultrastorage] Prefix ${JSON.stringify(options.prefix)} contains separator ${JSON.stringify(separator)}. Its entries may also match a broader namespace and be removed by that namespace's \`clear()\`. Use non-overlapping prefixes for independent data; changing existing prefixes requires migration.`,
      );
    }
  }

  function prefixedKey(key: StorageKey): string {
    return prefix + serializeStorageKey(key);
  }

  // Decoding is shared with snapshot readers; expiration cleanup belongs only
  // to the public read path below.
  function readEntry(key: StorageKey): StorageEntryEnvelope | null {
    return decodeEntry(getBackend().getItem(prefixedKey(key)), serializer);
  }

  function getItem<T = unknown>(key: StorageKey, options?: GetOptions<T>): T | null {
    const rawKey = prefixedKey(key);
    const raw = getBackend().getItem(rawKey);
    if (raw === null && options?.legacy) {
      return importLegacy(key, options);
    }
    const entry = decodeEntry(raw, serializer);
    if (entry === null) {
      return null;
    }

    if (entry.expiry != null && Date.now() > entry.expiry) {
      removeStoredItem(prefixedKey(key), 'expire');
      return null;
    }

    return validateEntry<T>(entry, options?.schema);
  }

  function importLegacy<T>(key: StorageKey, options: GetOptions<T>): T | null {
    const legacy = options.legacy!;
    const raw = getBackend().getItem(legacy.key);
    if (raw === null) return null;
    let value: unknown;
    try {
      value = legacy.deserialize(raw);
    } catch {
      return null;
    }
    if (isPromiseLike(value)) {
      void Promise.resolve(value).catch(() => {});
      throw new TypeError('Legacy deserialization must be synchronous.');
    }
    const result = validateValue(value, options.schema);
    if (result === null) return null;

    // Deliver notifications after cleanup so subscriber reads see the completed migration.
    batchNotifications(() => {
      setItem(key, result.value);
      removeStoredItem(legacy.key, 'remove');
    });
    return result.value;
  }

  function resolveExpiry(options?: StorageOptions): number | null {
    if (options?.ttl != null && options?.expiresAt != null) {
      throw new TypeError('Cannot specify both "ttl" and "expiresAt". Use one or the other.');
    }

    if (options?.ttl != null) {
      const expiry = Date.now() + options.ttl;
      if (!Number.isFinite(expiry)) {
        throw new TypeError('"ttl" must resolve to a finite expiration timestamp.');
      }
      return expiry;
    }

    if (options?.expiresAt != null) {
      const expiry =
        options.expiresAt instanceof Date ? options.expiresAt.getTime() : options.expiresAt;
      if (!Number.isFinite(expiry)) {
        throw new TypeError('"expiresAt" must be a finite expiration timestamp.');
      }
      return expiry;
    }

    return null;
  }

  function setItem<T = unknown>(key: StorageKey, value: T, options?: StorageOptions): void {
    const expiry = resolveExpiry(options);
    const serializedKey = serializeStorageKey(key);

    if (!isProduction) {
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

    if (!isProduction) {
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

      const entry = decodeEntry(raw, serializer);
      if (entry !== null) {
        yield [key, entry];
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
    const entry = readEntry(key);
    if (entry === null || (entry.expiry != null && Date.now() > entry.expiry)) {
      return false;
    }
    return true;
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
