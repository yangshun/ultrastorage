import { decodeEntry } from './entry';
import type { StorageEntryEnvelope } from './entry';
import type { GreatStorage, Serializer } from './types';

interface SnapshotAccess {
  readRaw: (key: string) => string | null;
  serializer: Serializer;
}

// Private, shared by all package entry points. No framework imports or global
// key cache: each reader's cache lives only as long as its consumer does.
const accessors = new WeakMap<GreatStorage, SnapshotAccess>();

export function registerSnapshotAccess(storage: GreatStorage, access: SnapshotAccess): void {
  accessors.set(storage, access);
}

export function createSnapshotReader(storage: GreatStorage, key: string) {
  const access = accessors.get(storage);
  if (!access) {
    throw new TypeError('The adapter requires a storage instance created by greatstorage.');
  }
  let previousRaw: string | null | undefined;
  let entry: StorageEntryEnvelope | null = null;
  return (): StorageEntryEnvelope | null => {
    const raw = access.readRaw(key);
    if (raw !== previousRaw) {
      entry = decodeEntry(raw, access.serializer);
      previousRaw = raw;
    }
    // Check time even when the bytes are unchanged, but never perform cleanup.
    return entry !== null && entry.expiry != null && Date.now() > entry.expiry ? null : entry;
  };
}
