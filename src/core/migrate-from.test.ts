import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryStorage, createStorage } from '../index';
import { createStorage as createCoreStorage } from '../core-entry';
import type { MigrateFromOptions, StorageOptions } from '../core-entry';

const migrateFrom: MigrateFromOptions = { key: 'old', deserialize: (raw) => ({ value: raw }) };
const schema: StandardSchemaV1<unknown, string> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      typeof value === 'string'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'Expected string' }] },
  },
};
function setup() {
  const backend = createMemoryStorage();
  backend.setItem('old', 'dark');
  return { backend, storage: createStorage({ storage: backend, prefix: 'app' }) };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('migrateFrom', () => {
  it('imports once, retains the source, and notifies destination subscribers after verification', () => {
    const { backend, storage } = setup();
    const peer = createStorage({ storage: backend, prefix: 'app' });
    const source = createStorage({ storage: backend });
    const onSource = vi.fn();
    const onDestination = vi.fn(() => {
      expect(backend.getItem('old')).toBe('dark');
      expect(peer.getItem('theme')).toBe('dark');
    });
    const stopSource = source.subscribe('old', onSource);
    const stopDestination = peer.subscribe('theme', onDestination);
    const deserialize = vi.fn(migrateFrom.deserialize);
    expect(storage.getItem('theme', { migrateFrom: { ...migrateFrom, deserialize } })).toBe('dark');
    expect(onDestination).toHaveBeenCalledExactlyOnceWith({
      key: 'theme',
      type: 'set',
      source: 'local',
    });
    expect(onSource).not.toHaveBeenCalled();
    expect(storage.getItem('theme', { migrateFrom: { ...migrateFrom, deserialize } })).toBe('dark');
    expect(deserialize).toHaveBeenCalledTimes(1);
    stopSource();
    stopDestination();
    storage.removeItem('theme');
    // Source retention is intentional: the app controls cleanup or migration completion.
    expect(storage.getItem('theme', { migrateFrom })).toBe('dark');
  });

  it('validates and persists schema output, inferring its type', () => {
    const { storage } = setup();
    const value = storage.getItem('theme', { migrateFrom, schema });
    expectTypeOf(value).toEqualTypeOf<string | null>();
    expect(value).toBe('DARK');
    expect(storage.getItem('theme')).toBe('DARK');
  });

  it.each([
    null,
    undefined,
    false,
    0,
    '',
    { value: 'data', options: { ttl: 1 } },
    new Map([['a', new Date(0)]]),
  ])('imports wrapped values without interpreting their payload: %s', (value) => {
    const { backend, storage } = setup();
    expect(
      storage.getItem('value', { migrateFrom: { key: 'old', deserialize: () => ({ value }) } }),
    ).toEqual(value);
    expect(storage.has('value')).toBe(true);
    expect(storage.getItem('value')).toEqual(value);
    expect(backend.getItem('old')).toBe('dark');
  });

  it('passes empty source strings to the deserializer and handles absent sources', () => {
    const { backend, storage } = setup();
    backend.setItem('old', '');
    expect(storage.getItem('empty', { migrateFrom })).toBe('');
    expect(
      storage.getItem('absent', { migrateFrom: { ...migrateFrom, key: 'missing' } }),
    ).toBeNull();
  });

  it('supports array destinations, custom separators, and the core serializer', () => {
    const { backend } = setup();
    const storage = createCoreStorage({
      storage: backend,
      prefix: 'app',
      separator: '/',
      serializer: JSON,
    });
    expect(storage.getItem(['theme', '1'], { migrateFrom })).toBe('dark');
    expect(storage.keys()).toEqual([['theme', '1']]);
    expect(backend.getItem('old')).toBe('dark');
  });

  it.each(['valid', 'null', 'empty', 'foreign', 'expired', 'invalid'])(
    'does not import over an occupied %s destination',
    (kind) => {
      const { backend, storage } = setup();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      if (kind === 'foreign' || kind === 'empty')
        backend.setItem('app:theme', kind === 'empty' ? '' : 'foreign');
      else
        storage.setItem(
          'theme',
          kind === 'null' ? null : kind === 'invalid' ? 42 : 'light',
          kind === 'expired' ? { expiresAt: 1 } : undefined,
        );
      const deserialize = vi.fn(migrateFrom.deserialize);
      storage.getItem('theme', { migrateFrom: { ...migrateFrom, deserialize }, schema });
      expect(deserialize).not.toHaveBeenCalled();
      expect(backend.getItem('old')).toBe('dark');
    },
  );

  it('does not import without opt-in or over a source at the destination key', () => {
    const { backend, storage } = setup();
    expect(storage.getItem('theme')).toBeNull();
    expect(
      storage.getItem('theme', { migrateFrom: { ...migrateFrom, key: 'app:theme' } }),
    ).toBeNull();
    backend.setItem('app:theme', 'raw');
    expect(
      storage.getItem('theme', { migrateFrom: { ...migrateFrom, key: 'app:theme' } }),
    ).toBeNull();
    expect(backend.getItem('app:theme')).toBe('raw');
  });

  it('rejects the obsolete option loudly, even when the destination exists', () => {
    const { storage } = setup();
    storage.setItem('theme', 'light');
    expect(() =>
      storage.getItem('theme', {
        // @ts-expect-error The old option was intentionally removed.
        legacy: { key: 'old', deserialize: (raw: string) => raw },
      }),
    ).toThrow('renamed to "migrateFrom"');
  });

  it.each([
    'raw string',
    42,
    false,
    null,
    undefined,
    [],
    { theme: 'dark' },
    Object.create({ value: 'inherited' }),
  ])('rejects unwrapped or malformed deserializer output: %s', (output) => {
    const { backend, storage } = setup();
    expect(() =>
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: (() => output) as MigrateFromOptions['deserialize'],
        },
      }),
    ).toThrow('return an object with { value, options? }');
    expect(backend.getItem('old')).toBe('dark');
    expect(backend.getItem('app:theme')).toBeNull();
  });

  it.each([null, [], '1000', 1000])('rejects malformed write options: %s', (options) => {
    const { backend, storage } = setup();
    expect(() =>
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: () => ({ value: 'dark', options: options as unknown as StorageOptions }),
        },
      }),
    ).toThrow('StorageOptions object');
    expect(backend.getItem('old')).toBe('dark');
  });

  it.each([
    { ttl: Infinity },
    { expiresAt: NaN },
    { expiresAt: new Date(NaN) },
    { ttl: 10, expiresAt: null },
  ])('reuses write-option validation: %s', (options) => {
    const { backend, storage } = setup();
    expect(() =>
      storage.getItem('theme', {
        migrateFrom: { key: 'old', deserialize: () => ({ value: 'dark', options }) },
      }),
    ).toThrow(TypeError);
    expect(backend.getItem('old')).toBe('dark');
    expect(backend.getItem('app:theme')).toBeNull();
  });

  it('preserves the original deadline and does not refresh it on subsequent reads', () => {
    vi.useFakeTimers({ now: 1000 });
    const { backend, storage } = setup();
    const options = {
      migrateFrom: {
        key: 'old',
        deserialize: (raw: string) => ({ value: raw, options: { expiresAt: new Date(2000) } }),
      },
    };
    expect(storage.getItem('theme', options)).toBe('dark');
    expect(storage.getExpiration('theme')).toEqual({ expiresAt: 2000 });
    vi.setSystemTime(2000);
    expect(storage.getItem('theme', options)).toBe('dark');
    expect(storage.getExpiration('theme')).toEqual({ expiresAt: 2000 });
    vi.setSystemTime(2001);
    expect(storage.getItem('theme', options)).toBeNull();
    expect(storage.getItem('theme', options)).toBeNull();
    expect(backend.getItem('app:theme')).toBeNull();
    expect(backend.getItem('old')).toBe('dark');
  });

  it('skips expired sources before validation and sources that expire during callbacks', () => {
    vi.useFakeTimers({ now: 1000 });
    const { backend, storage } = setup();
    const validate = vi.fn((value: unknown) => {
      vi.setSystemTime(1006);
      return { value };
    });
    const readSchema: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'test', validate } };
    expect(
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: () => ({ value: 'dark', options: { expiresAt: 999 } }),
        },
        schema: readSchema,
      }),
    ).toBeNull();
    expect(validate).not.toHaveBeenCalled();
    expect(
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: () => ({ value: 'dark', options: { expiresAt: 1005 } }),
        },
        schema: readSchema,
      }),
    ).toBeNull();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(backend.getItem('app:theme')).toBeNull();
    expect(backend.getItem('old')).toBe('dark');
  });

  it.each([{ ttl: 100 }, { expiresAt: null }])(
    'applies optional write policy only on the importing read: %s',
    (options) => {
      vi.useFakeTimers({ now: 1000 });
      const { storage } = setup();
      const migration = { ...migrateFrom, deserialize: () => ({ value: 'dark', options }) };
      storage.getItem('theme', { migrateFrom: migration });
      vi.setSystemTime(1050);
      storage.getItem('theme', { migrateFrom: migration });
      expect(storage.getExpiration('theme')).toEqual({ expiresAt: 'ttl' in options ? 1100 : null });
    },
  );

  it('retains source bytes on decoder exceptions or schema issues', () => {
    const { backend, storage } = setup();
    expect(
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: () => {
            throw new Error('decode');
          },
        },
      }),
    ).toBeNull();
    expect(
      storage.getItem('theme', {
        migrateFrom: { key: 'old', deserialize: () => ({ value: 42 }) },
        schema,
      }),
    ).toBeNull();
    expect(backend.getItem('old')).toBe('dark');
    expect(backend.getItem('app:theme')).toBeNull();
  });

  it('rejects asynchronous deserializers and schemas without unhandled rejections', async () => {
    const { backend, storage } = setup();
    expect(() =>
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: (() =>
            Promise.reject(new Error('async'))) as unknown as MigrateFromOptions['deserialize'],
        },
      }),
    ).toThrow('deserialization must be synchronous');
    expect(() =>
      storage.getItem('theme', {
        migrateFrom,
        schema: {
          '~standard': {
            version: 1,
            vendor: 'test',
            validate: () => Promise.reject(new Error('async')),
          },
        },
      }),
    ).toThrow('Schema validation must be synchronous');
    await Promise.resolve();
    expect(backend.getItem('old')).toBe('dark');
    expect(backend.getItem('app:theme')).toBeNull();
  });

  it.each(['destination-read', 'source-read', 'schema', 'serialize', 'write', 'verify-read'])(
    'propagates %s failures and retains the source',
    (kind) => {
      const { backend } = setup();
      const error = new Error(kind);
      const read = backend.getItem.bind(backend);
      const write = backend.setItem.bind(backend);
      let written = false;
      if (kind.endsWith('read'))
        vi.spyOn(backend, 'getItem').mockImplementation((key) => {
          if (
            (kind === 'destination-read' && key === 'app:theme') ||
            (kind === 'source-read' && key === 'old') ||
            (kind === 'verify-read' && written)
          )
            throw error;
          return read(key);
        });
      vi.spyOn(backend, 'setItem').mockImplementation((key, value) => {
        if (kind === 'write') throw error;
        write(key, value);
        written = true;
      });
      const storage = createCoreStorage({
        storage: backend,
        prefix: 'app',
        serializer: {
          parse: JSON.parse,
          stringify:
            kind === 'serialize'
              ? () => {
                  throw error;
                }
              : JSON.stringify,
        },
      });
      expect(() =>
        storage.getItem('theme', {
          migrateFrom,
          ...(kind === 'schema'
            ? {
                schema: {
                  '~standard': {
                    version: 1 as const,
                    vendor: 'test',
                    validate: () => {
                      throw error;
                    },
                  },
                },
              }
            : {}),
        }),
      ).toThrow(error);
      expect(read('old')).toBe('dark');
    },
  );

  it('protects reentrant destination and source writes', () => {
    const { backend, storage } = setup();
    expect(
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: (raw) => {
            storage.setItem('theme', 'newer');
            return { value: raw };
          },
        },
      }),
    ).toBe('newer');
    storage.removeItem('theme');
    expect(() =>
      storage.getItem('theme', {
        migrateFrom: {
          key: 'old',
          deserialize: (raw) => {
            backend.setItem('old', 'newer source');
            return { value: raw };
          },
        },
      }),
    ).toThrow('source changed');
    expect(backend.getItem('app:theme')).toBeNull();
    expect(backend.getItem('old')).toBe('newer source');
  });

  it.each(['not-written', 'unsupported', 'changed-expiry'])(
    'retains source when destination verification fails: %s',
    (kind) => {
      const { backend } = setup();
      if (kind === 'not-written') vi.spyOn(backend, 'setItem').mockImplementation(() => {});
      const storage = createCoreStorage({
        storage: backend,
        prefix: 'app',
        serializer: {
          stringify: kind === 'unsupported' ? () => '{}' : JSON.stringify,
          parse: (raw) => {
            const entry = JSON.parse(raw);
            return kind === 'changed-expiry' ? { ...entry, expiry: 1234 } : entry;
          },
        },
      });
      expect(() => storage.getItem('theme', { migrateFrom })).toThrow('could not be verified');
      expect(backend.getItem('old')).toBe('dark');
    },
  );

  it('excludes the migration source from quota recovery cleanup', () => {
    vi.useFakeTimers({ now: 1000 });
    const backend = createMemoryStorage();
    const storage = createStorage({
      storage: backend,
      prefix: 'app',
      onQuotaExceeded: 'clear-expired',
    });
    storage.setItem('old', 'draft', { ttl: 1 });
    vi.setSystemTime(1002);
    const source = backend.getItem('app:old');
    vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw { name: 'QuotaExceededError' };
    });
    expect(() =>
      storage.getItem('draft', {
        migrateFrom: { key: 'app:old', deserialize: () => ({ value: 'draft' }) },
      }),
    ).toThrow();
    expect(backend.getItem('app:old')).toBe(source);
  });
});
