'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { validateEntry } from './entry';
import { createSnapshotReader } from './snapshots';
import type { GreatStorage, StorageOptions } from './types';

export interface UseStorageOptions<T> {
  /**
   * Displayed when the read returns null and during SSR/initial hydration.
   * Never automatically persisted. Omitted or undefined defaults use null;
   * a valid stored undefined is preserved. Keep server and client defaults equal.
   */
  defaultValue?: T | null;
  /**
   * Synchronous read validation and transformation, matching getItem.
   * Validation issues use the default; async schemas and thrown errors propagate.
   * Defaults and writes are not validated.
   */
  schema?: StandardSchemaV1<unknown, T>;
}

/**
 * Write a replacement value or update the latest persisted value after schema
 * validation and fallback. Omitted options write without expiration. Errors
 * propagate, and read-modify-write updates are not atomic across tabs.
 */
export type StorageSetter<T, Current = T | null> = (
  value: T | ((previous: Current) => T),
  options?: StorageOptions,
) => void;

/** Reactive value, stable setter, and removal callback that restores the default. */
export type UseStorageResult<T, Current = T | null> = readonly [
  value: Current,
  setValue: StorageSetter<T, Current>,
  removeValue: () => void,
];

/** A hook bound to one instance, with the same options and result as useStorage. */
export interface StorageHook {
  <T>(
    key: string,
    options: {
      schema: StandardSchemaV1<unknown, T>;
      defaultValue: NoInfer<Exclude<T, null | undefined>>;
    },
  ): UseStorageResult<T, Exclude<T, null>>;
  <T>(
    key: string,
    options: UseStorageOptions<T> & { defaultValue: Exclude<T, null | undefined> },
  ): UseStorageResult<T, Exclude<T, null>>;
  <T = unknown>(key: string, options?: UseStorageOptions<T>): UseStorageResult<T>;
}

const useCommittedEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const getServerSnapshot = () => null;

/**
 * Subscribe to a key relative to the instance's prefix and infer schema output.
 * Treat returned objects as immutable and replace them through the setter.
 * Rendering never writes defaults or removes expired entries. Expiration has
 * no timer; later reads or cleanup notifications reveal an expired value.
 * @param storage A factory-created instance from greatstorage or greatstorage/core.
 * @param key Key to observe; changing it switches the subscription.
 * @param options Display-only fallback and optional synchronous read schema.
 * @returns A readonly [value, setValue, removeValue] tuple.
 */
export function useStorage<T>(
  storage: GreatStorage,
  key: string,
  options: {
    schema: StandardSchemaV1<unknown, T>;
    defaultValue: NoInfer<Exclude<T, null | undefined>>;
  },
): UseStorageResult<T, Exclude<T, null>>;
/** Subscribe with a default; null reads display that default without persisting it. */
export function useStorage<T>(
  storage: GreatStorage,
  key: string,
  options: UseStorageOptions<T> & { defaultValue: Exclude<T, null | undefined> },
): UseStorageResult<T, Exclude<T, null>>;
/** Subscribe to a typed key; without a default, missing or invalid values return null. */
export function useStorage<T = unknown>(
  storage: GreatStorage,
  key: string,
  options?: UseStorageOptions<T>,
): UseStorageResult<T>;
export function useStorage<T>(
  storage: GreatStorage,
  key: string,
  options?: UseStorageOptions<T>,
): UseStorageResult<T> {
  const read = useMemo(() => createSnapshotReader(storage, key), [storage, key]);
  const subscribe = useCallback(
    (listener: () => void) => storage.subscribe(key, listener),
    [storage, key],
  );
  const snapshot = useSyncExternalStore(subscribe, read, getServerSnapshot);
  const schema = options?.schema;
  const value = useMemo(() => validateEntry<T>(snapshot, schema), [snapshot, schema]);
  // Updating only after commit avoids exposing options from abandoned renders.
  const committed = useRef(options);
  useCommittedEffect(() => {
    committed.current = options;
  });

  const setValue = useCallback<StorageSetter<T>>(
    (next, writeOptions) => {
      let updated: T;
      if (typeof next === 'function') {
        const currentOptions = committed.current;
        const current = validateEntry<T>(read(), currentOptions?.schema);
        const previous = current === null ? fallback(currentOptions) : current;
        updated = (next as (previous: T | null) => T)(previous);
      } else {
        updated = next;
      }
      storage.setItem(key, updated, writeOptions);
    },
    [storage, key, read],
  );
  const removeValue = useCallback(() => storage.removeItem(key), [storage, key]);

  return [value === null ? fallback(options) : value, setValue, removeValue];
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
export function createStorageHook(storage: GreatStorage): StorageHook {
  return function useBoundStorage<T>(key: string, options?: UseStorageOptions<T>) {
    return useStorage(storage, key, options);
  } as StorageHook;
}
