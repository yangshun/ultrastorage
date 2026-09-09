import { stringify, parse } from 'devalue';
import { createStorage as createStorageCore } from './core';
import type { CreateStorageOptions, UltraStorage } from './types';

// Re-export everything from core-entry. The explicit createStorage below
// takes precedence over the one from the wildcard, so the rest of the
// public surface is defined in exactly one place.
export * from './core-entry';

export function createStorage(options: CreateStorageOptions = {}): UltraStorage {
  return createStorageCore({
    ...options,
    serializer: options.serializer ?? { stringify, parse },
  });
}
