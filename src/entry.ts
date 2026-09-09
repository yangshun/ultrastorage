import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Serializer } from './types';

export interface StorageEntryEnvelope {
  [key: string]: unknown;
  value: unknown;
  version: number;
  expiry: number | null;
}

export function isStorageEntry(data: unknown): data is StorageEntryEnvelope {
  return (
    typeof data === 'object' &&
    data !== null &&
    '__gs' in data &&
    data.__gs === true &&
    'value' in data &&
    'version' in data &&
    'expiry' in data
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
  if (!schema) return entry.value as T;
  const result = schema['~standard'].validate(entry.value);
  if (result instanceof Promise) {
    throw new TypeError('Schema validation must be synchronous. Async schemas are not supported.');
  }
  return 'issues' in result ? null : result.value;
}
