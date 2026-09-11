import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Serializer } from './types';

export interface StorageEntryEnvelope {
  [key: string]: unknown;
  value: unknown;
  version: 1;
  expiry: number | null;
}

export function isStorageEntry(data: unknown): data is StorageEntryEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    (('__us' in data && data.__us === true) || ('__gs' in data && data.__gs === true)) &&
    'value' in data &&
    'version' in data &&
    data.version === 1 &&
    'expiry' in data &&
    (data.expiry === null || (typeof data.expiry === 'number' && Number.isFinite(data.expiry)))
  );
}

export function decodeEntry(
  raw: string | null,
  serializer: Serializer,
): StorageEntryEnvelope | null {
  if (raw === null) return null;
  let entry: unknown;
  try {
    entry = serializer.parse(raw);
  } catch {
    try {
      entry = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isStorageEntry(entry) ? entry : null;
}

export function validateEntry<T>(
  entry: StorageEntryEnvelope | null,
  schema?: StandardSchemaV1<unknown, T>,
): T | null {
  if (entry === null) return null;
  const result = validateValue(entry.value, schema);
  return result === null ? null : result.value;
}

export function validateValue<T>(
  value: unknown,
  schema?: StandardSchemaV1<unknown, T>,
): { value: T } | null {
  if (!schema) return { value: value as T };
  const result = schema['~standard'].validate(value);
  if (isPromiseLike(result)) {
    // Validation has already started; consume any rejection before rejecting async schemas.
    void Promise.resolve(result).catch(() => {});
    throw new TypeError('Schema validation must be synchronous. Async schemas are not supported.');
  }
  return result.issues === undefined ? { value: result.value } : null;
}

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
