import type { StorageKey } from './types';

// Arrays need their own unlikely-to-be-authored key space because the Storage
// backend only accepts strings. The format is deliberately opaque but stable:
// JSON preserves every string segment without relying on the namespace separator.
const ARRAY_KEY_PREFIX = '\u0000us:a:';

export function serializeStorageKey(key: StorageKey): string {
  if (typeof key === 'string') {
    return key;
  }

  if (!Array.isArray(key)) {
    throw new TypeError('Storage keys must be strings or arrays of strings.');
  }

  for (const segment of key) {
    if (typeof segment !== 'string') {
      throw new TypeError('Array storage keys can only contain strings.');
    }
  }

  return ARRAY_KEY_PREFIX + JSON.stringify(key);
}

export function deserializeStorageKey(key: string): StorageKey {
  if (!key.startsWith(ARRAY_KEY_PREFIX)) {
    return key;
  }

  let segments: unknown;
  try {
    segments = JSON.parse(key.slice(ARRAY_KEY_PREFIX.length));
  } catch {
    return key;
  }

  // Only decode canonical array keys so the result still addresses the same entry.
  if (
    Array.isArray(segments) &&
    segments.every((segment: unknown) => typeof segment === 'string') &&
    serializeStorageKey(segments) === key
  ) {
    return segments;
  }
  return key;
}
