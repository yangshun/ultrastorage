import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface StorageOptions {
  /**
   * Time-to-live in milliseconds. If not set, the item never expires.
   * Cannot be used together with `expiresAt`.
   */
  ttl?: number;

  /**
   * Absolute expiration time as a `Date` or Unix timestamp in milliseconds.
   * Cannot be used together with `ttl`.
   */
  expiresAt?: Date | number;
}

export interface GetOptions<T> {
  /**
   * A Standard Schema to validate the retrieved value against.
   * If validation fails, `getItem` returns `null`.
   */
  schema: StandardSchemaV1<unknown, T>;
}

/** A string key or an array of string segments serialized as one opaque key. */
export type StorageKey = string | readonly string[];

/** A storage change. Read the current value with `getItem()`. */
export interface StorageChange {
  /** The key relative to the prefix. Array keys use their serialized string form. */
  readonly key: string;
  readonly type: 'set' | 'remove' | 'expire';
  /** `local` includes other instances on this page; `external` means a browser storage event. */
  readonly source: 'local' | 'external';
}

export type StorageListener = (change: StorageChange) => void;

interface UltraStorageExtensions {
  /**
   * Listens for changes to a key, without immediately invoking the listener.
   * Local notifications are synchronous; external browser events arrive asynchronously.
   * Expiration is lazy: only expiration cleanup emits an event, not the passage of time.
   * Returns an unsubscribe function that is safe to call repeatedly.
   */
  subscribe(key: StorageKey, listener: StorageListener): () => void;

  /**
   * The number of non-expired entries in the current namespace.
   * Scans stored entries on each access. Use `keys()` for full enumeration.
   */
  readonly length: number;

  /**
   * Retrieves, deserializes, and validates a value.
   * Returns `null` if the key is missing, the entry has expired, or schema validation fails.
   *
   * @param key - The storage key.
   * @param options - Optional. Pass `{ schema }` to validate the value against a Standard Schema.
   */
  getItem<T>(key: StorageKey, options: GetOptions<T>): T | null;
  getItem<T = unknown>(key: StorageKey): T | null;

  /**
   * Serializes and stores a value, optionally with a TTL or absolute expiration time.
   *
   * @param key - The storage key.
   * @param value - The value to store. Supports rich types like `Set`, `Map`, `Date`, etc.
   * @param options - Optional. Set `ttl` (milliseconds) or `expiresAt` (Date or timestamp).
   */
  setItem<T = unknown>(key: StorageKey, value: T, options?: StorageOptions): void;

  /**
   * Removes a single entry by key.
   *
   * @param key - The storage key to remove.
   */
  removeItem(key: StorageKey): void;

  /**
   * Returns the key at the given index among non-expired entries, or `null` if out of bounds.
   * Keys are relative to the prefix. String keys remain strings, and array keys
   * return fresh arrays of their original segments.
   * Scans entries from the beginning. Use `keys()` for full enumeration.
   *
   * @param index - Zero-based index.
   */
  key(index: number): StorageKey | null;

  /**
   * Returns a fresh array of non-expired keys in the current namespace in one scan.
   * Keys follow backend enumeration order and are relative to the prefix. String keys
   * remain strings, and array keys return fresh arrays of their original segments.
   * Expiration is checked at call time.
   * Does not remove expired entries or notify subscribers.
   */
  keys(): StorageKey[];

  /**
   * Returns the existing value for `key`, or calls `factory()` to create, store, and return a new value.
   *
   * @param key - The storage key.
   * @param factory - A function that produces the initial value if the key is missing or expired.
   * @param options - Optional. Same expiration options as `setItem`.
   */
  getOrInit<T>(key: StorageKey, factory: () => T, options?: StorageOptions): T;

  /**
   * Reads the current value, passes it through `updater`, stores the result, and returns it.
   *
   * @param key - The storage key.
   * @param updater - A function that receives the current value (or `null`) and returns the new value.
   * @param options - Optional. Same expiration options as `setItem`.
   */
  updateItem<T = unknown>(
    key: StorageKey,
    updater: (value: T | null) => T,
    options?: StorageOptions,
  ): T;

  /**
   * Removes all ultrastorage entries in the current namespace.
   * Non-ultrastorage entries and entries outside the namespace are left untouched.
   */
  clear(): void;

  /**
   * Removes only expired entries in the current namespace.
   */
  clearExpired(): void;

  /**
   * Returns `true` if the key exists and has not expired.
   *
   * @param key - The storage key to check.
   */
  has(key: StorageKey): boolean;
}

/**
 * UltraStorage provides familiar `Storage` methods, with typed reads, rich-value
 * serialization, expiration, namespacing, and subscriptions.
 * Reads return deserialized values; named property access is unsupported.
 * Raw stored values require migration, and `clear()` only removes recognized
 * entries within the configured namespace.
 */
export type UltraStorage = UltraStorageExtensions;

export interface Serializer {
  stringify: (value: unknown) => string;
  parse: (raw: string) => unknown;
}

export interface CreateStorageOptions {
  /**
   * Key prefix for namespacing. All keys will be stored as `${prefix}${separator}${key}`.
   */
  prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  separator?: string;

  /**
   * The underlying Storage backend. Defaults to `localStorage`, resolved on first use.
   */
  storage?: Storage;

  /**
   * Custom serializer with `stringify` and `parse` methods.
   * Defaults to `devalue`.
   */
  serializer?: Serializer;
}

/**
 * Options for the core `createStorage` function (from `ultrastorage/core`).
 * `serializer` is required because the core entry point does not bundle `devalue`.
 */
export type CoreStorageOptions = Omit<CreateStorageOptions, 'serializer'> & {
  /** Custom serializer with `stringify` and `parse` methods. */
  serializer: Serializer;
};
