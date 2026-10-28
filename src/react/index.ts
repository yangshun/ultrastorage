'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { validateValueResult } from '../core/entry';
import { serializeStorageKey } from '../core/keys';
import { createSnapshotReader } from '../core/snapshots';
import type { StorageSnapshotResult } from '../core/snapshots';
import type { UltraStorage, StorageKey, StorageOptions, StorageReadResult } from '../core/types';
import { resolveWriteOptions } from './write-options';

export interface UseStorageOptions<T> {
  /** Add read outcomes and the last mutation error as a fourth tuple item. Setters still throw. */
  diagnostics?: boolean;
  /** Default expiration for writes to this key. Setter expiration replaces it; reads never refresh it. */
  writeOptions?: StorageOptions;
  /** Update when the entry expires without deleting it. Defaults to false. */
  reactiveExpiration?: boolean;
  /**
   * Displayed when the read returns null and during SSR/initial hydration.
   * Never automatically persisted. Omitted or undefined defaults use null;
   * a valid stored undefined is preserved. Keep server and client defaults equal.
   */
  defaultValue?: T | null;
  /**
   * Synchronous read validation and transformation, matching getItem.
   * Validation issues use the default; thrown read errors propagate unless diagnostics are enabled.
   * Defaults and writes are not validated.
   */
  schema?: StandardSchemaV1<unknown, T>;
}

/**
 * Write a replacement value or update the latest persisted value after schema
 * validation and fallback. Omitted options use the hook's writeOptions, otherwise
 * preserve the current unexpired deadline. Errors
 * propagate, and read-modify-write updates are not atomic across tabs.
 */
export type StorageSetter<T, Current = T | null> = (
  value: T | ((previous: Current) => T),
  options?: StorageOptions,
) => void;

/** Opt-in read outcomes and mutation diagnostics; mutations keep their throwing behavior. */
export interface StorageDiagnostics<T> {
  readResult:
    | StorageReadResult<T>
    | { readonly __result: true; status: 'pending' }
    | { readonly __result: true; status: 'unavailable'; error: unknown }
    | { readonly __result: true; status: 'read-error'; error: unknown };
  /** Last failed mutation in this hook for the current instance and key. Success clears it. */
  lastError: { operation: 'write' | 'remove'; error: unknown } | null;
}

export type UseStorageResult<
  T,
  Current = T | null,
  Diagnostics extends boolean = false,
> = readonly [
  value: Current,
  setValue: StorageSetter<T, Current>,
  removeValue: () => void,
  ...diagnostics: Diagnostics extends true ? [StorageDiagnostics<T>] : [],
];

type SchemaDefaultOptions<T> = Omit<UseStorageOptions<T>, 'defaultValue'> & {
  schema: StandardSchemaV1<unknown, T>;
  defaultValue: NoInfer<Exclude<T, null | undefined>>;
};
type DefaultOptions<T> = UseStorageOptions<T> & { defaultValue: Exclude<T, null | undefined> };

/** A hook bound to one instance, with the same options and result as useStorage. */
export interface StorageHook {
  <T>(
    key: StorageKey,
    options: SchemaDefaultOptions<T> & { diagnostics: true },
  ): UseStorageResult<T, Exclude<T, null>, true>;
  <T>(
    key: StorageKey,
    options: DefaultOptions<T> & { diagnostics: true },
  ): UseStorageResult<T, Exclude<T, null>, true>;
  <T = unknown>(
    key: StorageKey,
    options: UseStorageOptions<T> & { diagnostics: true },
  ): UseStorageResult<T, T | null, true>;
  <T>(
    key: StorageKey,
    options: SchemaDefaultOptions<T> & { diagnostics?: false },
  ): UseStorageResult<T, Exclude<T, null>>;
  <T>(
    key: StorageKey,
    options: DefaultOptions<T> & { diagnostics?: false },
  ): UseStorageResult<T, Exclude<T, null>>;
  <T = unknown>(
    key: StorageKey,
    options?: UseStorageOptions<T> & { diagnostics?: false },
  ): UseStorageResult<T>;
  <T = unknown>(
    key: StorageKey,
    options?: UseStorageOptions<T>,
  ): UseStorageResult<T, T | null, boolean>;
}

const useCommittedEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const pending = { status: 'pending' } as const;
const getServerSnapshot = () => pending;

/**
 * Subscribe to a key relative to the instance's prefix and infer schema output.
 * Treat returned objects as immutable and replace them through the setter.
 * Rendering never writes defaults or removes expired entries. Opt in with
 * reactiveExpiration to update when the deadline passes; timers may run late.
 * @param storage A factory-created instance from ultrastorage or ultrastorage/core.
 * @param key Key to observe; changing it switches the subscription.
 * @param options Display-only fallback, synchronous read schema, and opt-in reactive expiration.
 * @returns A readonly [value, setValue, removeValue] tuple; opt-in diagnostics add a fourth item.
 */
export function useStorage<T>(
  storage: UltraStorage,
  key: StorageKey,
  options: SchemaDefaultOptions<T> & { diagnostics: true },
): UseStorageResult<T, Exclude<T, null>, true>;
export function useStorage<T>(
  storage: UltraStorage,
  key: StorageKey,
  options: DefaultOptions<T> & { diagnostics: true },
): UseStorageResult<T, Exclude<T, null>, true>;
export function useStorage<T = unknown>(
  storage: UltraStorage,
  key: StorageKey,
  options: UseStorageOptions<T> & { diagnostics: true },
): UseStorageResult<T, T | null, true>;
export function useStorage<T>(
  storage: UltraStorage,
  key: StorageKey,
  options: SchemaDefaultOptions<T> & { diagnostics?: false },
): UseStorageResult<T, Exclude<T, null>>;
/** Subscribe with a default; null reads display that default without persisting it. */
export function useStorage<T>(
  storage: UltraStorage,
  key: StorageKey,
  options: DefaultOptions<T> & { diagnostics?: false },
): UseStorageResult<T, Exclude<T, null>>;
/** Subscribe to a typed key; without a default, missing or invalid values return null. */
export function useStorage<T = unknown>(
  storage: UltraStorage,
  key: StorageKey,
  options?: UseStorageOptions<T> & { diagnostics?: false },
): UseStorageResult<T>;
export function useStorage<T = unknown>(
  storage: UltraStorage,
  key: StorageKey,
  options?: UseStorageOptions<T>,
): UseStorageResult<T, T | null, boolean>;
export function useStorage<T>(
  storage: UltraStorage,
  key: StorageKey,
  options?: UseStorageOptions<T>,
): UseStorageResult<T, T | null, boolean> {
  const serializedKey = serializeStorageKey(key);
  const read = useMemo(
    () => createSnapshotReader(storage, serializedKey),
    [storage, serializedKey],
  );
  const reactiveExpiration = options?.reactiveExpiration ?? false;
  const diagnosticsEnabled = options?.diagnostics ?? false;
  const subscriptionFailed = useRef(false);
  const [subscriptionAttempt, retrySubscription] = useReducer((attempt: number) => attempt + 1, 0);
  const subscribe = useCallback(
    (listener: () => void) => {
      try {
        const stop = storage.subscribe(serializedKey, listener, { reactiveExpiration });
        subscriptionFailed.current = false;
        return stop;
      } catch (error) {
        if (!diagnosticsEnabled) throw error;
        subscriptionFailed.current = true;
        return () => {};
      }
    },
    [storage, serializedKey, reactiveExpiration, diagnosticsEnabled, subscriptionAttempt],
  );
  const snapshot = useSyncExternalStore<StorageSnapshotResult | typeof pending>(
    subscribe,
    read,
    getServerSnapshot,
  );
  useEffect(() => {
    // Reattach after an unavailable backend recovers on a subsequent render.
    if (subscriptionFailed.current && snapshot.status !== 'unavailable') {
      subscriptionFailed.current = false;
      retrySubscription();
    }
  }, [snapshot]);
  const schema = options?.schema;
  const readResult = useMemo(() => projectSnapshot<T>(snapshot, schema), [snapshot, schema]);
  // Updating only after commit avoids exposing options from abandoned renders.
  const committed = useRef(options);
  useCommittedEffect(() => {
    committed.current = options;
  });
  const [failure, setFailure] = useState<{
    storage: UltraStorage;
    key: string;
    value: NonNullable<StorageDiagnostics<T>['lastError']>;
  } | null>(null);

  const setValue = useCallback<StorageSetter<T>>(
    (next, writeOptions) => {
      try {
        let updated: T;
        const currentOptions = committed.current;
        if (typeof next === 'function') {
          const current = projectSnapshot<T>(read(), currentOptions?.schema);
          throwReadError(current);
          const previous =
            current.status === 'success' && current.value !== null
              ? current.value
              : fallback(currentOptions);
          updated = (next as (previous: T | null) => T)(previous);
        } else {
          updated = next;
        }
        storage.setItem(
          serializedKey,
          updated,
          resolveWriteOptions(currentOptions?.writeOptions, writeOptions),
        );
        setFailure(null);
      } catch (error) {
        if (committed.current?.diagnostics)
          setFailure({ storage, key: serializedKey, value: { operation: 'write', error } });
        throw error;
      }
    },
    [storage, serializedKey, read],
  );
  const removeValue = useCallback(() => {
    try {
      storage.removeItem(serializedKey);
      setFailure(null);
    } catch (error) {
      if (committed.current?.diagnostics)
        setFailure({ storage, key: serializedKey, value: { operation: 'remove', error } });
      throw error;
    }
  }, [storage, serializedKey]);

  const lastError =
    failure?.storage === storage && failure.key === serializedKey ? failure.value : null;
  const diagnostics = useMemo<StorageDiagnostics<T>>(
    () => ({ readResult, lastError }),
    [readResult, lastError],
  );
  if (!diagnosticsEnabled) throwReadError(readResult);
  const value =
    readResult.status === 'success' && readResult.value !== null
      ? readResult.value
      : fallback(options);
  return diagnosticsEnabled
    ? [value, setValue, removeValue, diagnostics]
    : [value, setValue, removeValue];
}

function projectSnapshot<T>(
  snapshot: StorageSnapshotResult | typeof pending,
  schema?: StandardSchemaV1<unknown, T>,
): StorageDiagnostics<T>['readResult'] {
  if (snapshot.status !== 'success') return { __result: true, ...snapshot };
  try {
    return { __result: true, ...validateValueResult(snapshot.value.value, schema) };
  } catch (error) {
    return { __result: true, status: 'read-error', error };
  }
}

function throwReadError(result: StorageDiagnostics<unknown>['readResult']): void {
  if (result.status === 'unavailable' || result.status === 'read-error') throw result.error;
}

function fallback<T>(options: UseStorageOptions<T> | undefined): T | null {
  return options?.defaultValue ?? null;
}

/**
 * Bind once outside components; the returned function is a React hook.
 * It accepts (key, options?) and returns the same tuple as useStorage, using
 * the bound instance's backend, prefix, separator, and serializer.
 * @example
 * const usePreferences = createStorageHook(preferences);
 * // Inside a component:
 * const [theme, setTheme] = usePreferences('theme', { defaultValue: 'light' });
 */
export function createStorageHook(storage: UltraStorage): StorageHook {
  return function useBoundStorage<T>(key: StorageKey, options?: UseStorageOptions<T>) {
    return useStorage(storage, key, options);
  } as StorageHook;
}
