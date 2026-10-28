import type { StorageOptions } from '../core/types';

/** A setter's explicit expiration replaces the whole default expiration policy. */
export function resolveWriteOptions(
  defaults?: StorageOptions,
  overrides?: StorageOptions,
): StorageOptions | undefined {
  return overrides?.ttl != null || overrides?.expiresAt !== undefined ? overrides : defaults;
}
