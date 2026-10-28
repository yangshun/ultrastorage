import { decodeEntryResult } from './entry';
import type { StorageEntryEnvelope } from './entry';
import type { UltraStorage, Serializer, StorageReadOutcome } from './types';

interface SnapshotAccess {
  readRaw: (key: string) => string | null;
  serializer: Serializer;
  fallbackParser?: Serializer['parse'];
}

// Private, shared by all package entry points. No framework imports or global
// key cache: each reader's cache lives only as long as its consumer does.
const accessors = new WeakMap<UltraStorage, SnapshotAccess>();

export function registerSnapshotAccess(storage: UltraStorage, access: SnapshotAccess): void {
  accessors.set(storage, access);
}

/** Internal, side-effect-free detailed snapshots. Failures are cached to satisfy React's snapshot contract. */
export type StorageSnapshotResult =
  | StorageReadOutcome<StorageEntryEnvelope>
  | { status: 'unavailable'; error: unknown }
  | { status: 'read-error'; error: unknown };

export function createSnapshotReader(storage: UltraStorage, key: string) {
  const access = accessors.get(storage);
  if (!access)
    throw new TypeError('The adapter requires a storage instance created by ultrastorage.');
  let previousRaw: string | null | undefined;
  let decoded: StorageSnapshotResult = { status: 'missing' };
  let result: StorageSnapshotResult | undefined;

  return (): StorageSnapshotResult => {
    let raw: string | null;
    try {
      raw = access.readRaw(key);
    } catch (error) {
      if (result?.status !== 'unavailable') result = { status: 'unavailable', error };
      return result;
    }
    if (raw !== previousRaw || result?.status === 'unavailable') {
      try {
        decoded = decodeEntryResult(raw, access.serializer, access.fallbackParser);
      } catch (error) {
        decoded = { status: 'read-error', error };
      }
      previousRaw = raw;
      result = undefined;
    }
    if (
      decoded.status === 'success' &&
      decoded.value.expiry !== null &&
      Date.now() > decoded.value.expiry
    ) {
      if (result?.status !== 'expired')
        result = { status: 'expired', expiresAt: decoded.value.expiry };
      return result;
    }
    return (result = decoded);
  };
}
