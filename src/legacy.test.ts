import { describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';

function setup() {
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend, prefix: 'app' });
  backend.setItem('old', 'dark');
  return { backend, storage };
}

const legacy = { key: 'old', deserialize: (raw: string) => raw };
const schema: StandardSchemaV1<unknown, string> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      typeof value === 'string'
        ? { value: value.toUpperCase() }
        : { issues: [{ message: 'Invalid' }] },
  },
};

describe('legacy imports', () => {
  it('imports once, notifies after cleanup, and does not resurrect removed values', () => {
    const { backend, storage } = setup();
    const other = createStorage({ storage: backend, prefix: 'app' });
    const listener = vi.fn(() => {
      expect(backend.getItem('old')).toBeNull();
      expect(other.getItem('theme')).toBe('dark');
    });
    const unsubscribe = other.subscribe('theme', listener);
    const deserialize = vi.fn(legacy.deserialize);
    expect(storage.getItem('theme', { legacy: { ...legacy, deserialize } })).toBe('dark');
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      key: 'theme',
      type: 'set',
      source: 'local',
    });
    expect(storage.getItem('theme', { legacy: { ...legacy, deserialize } })).toBe('dark');
    expect(deserialize).toHaveBeenCalledTimes(1);
    unsubscribe();
    storage.removeItem('theme');
    expect(storage.getItem('theme', { legacy })).toBeNull();
  });

  it('notifies source subscribers and still announces a write when cleanup fails', () => {
    const { backend, storage } = setup();
    const source = createStorage({ storage: backend });
    const sourceListener = vi.fn();
    const destinationListener = vi.fn();
    const unsubscribeSource = source.subscribe('old', sourceListener);
    const unsubscribeDestination = storage.subscribe('theme', destinationListener);
    vi.spyOn(backend, 'removeItem').mockImplementationOnce(() => {
      throw new Error('cleanup');
    });
    expect(() => storage.getItem('theme', { legacy })).toThrow('cleanup');
    expect(destinationListener).toHaveBeenCalledTimes(1);
    expect(sourceListener).not.toHaveBeenCalled();
    storage.removeItem('theme');
    storage.getItem('theme', { legacy });
    expect(sourceListener).toHaveBeenCalledExactlyOnceWith({
      key: 'old',
      type: 'remove',
      source: 'local',
    });
    unsubscribeSource();
    unsubscribeDestination();
  });

  it('persists schema output and infers its type', () => {
    const { storage } = setup();
    const value = storage.getItem('theme', { legacy, schema });
    expectTypeOf(value).toEqualTypeOf<string | null>();
    expect(value).toBe('DARK');
    expect(storage.getItem('theme')).toBe('DARK');
  });

  it.each(['', 'null', 'false', '0', '{"theme":"dark"}'])(
    'imports JSON or empty string: %s',
    (raw) => {
      const { backend, storage } = setup();
      backend.setItem('old', raw);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const value = raw === '' ? '' : JSON.parse(raw);
      expect(
        storage.getItem('value', {
          legacy: { key: 'old', deserialize: raw === '' ? legacy.deserialize : JSON.parse },
        }),
      ).toEqual(value);
      expect(storage.has('value')).toBe(true);
      expect(storage.getItem('value')).toEqual(value);
      expect(backend.getItem('old')).toBeNull();
      warn.mockRestore();
    },
  );

  it('preserves a validated null as a successful import', () => {
    const { backend, storage } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.getItem('value', {
      legacy,
      schema: { '~standard': { version: 1, vendor: 'test', validate: () => ({ value: null }) } },
    });
    expect(storage.has('value')).toBe(true);
    expect(backend.getItem('old')).toBeNull();
    warn.mockRestore();
  });

  it('supports array destinations, custom separators, and the core serializer', () => {
    const backend = createMemoryStorage();
    backend.setItem('old', '{"darkMode":true}');
    const storage = createCoreStorage({
      storage: backend,
      prefix: 'app',
      separator: '/',
      serializer: JSON,
    });
    expect(
      storage.getItem(['settings', 'theme'], {
        legacy: { key: 'old', deserialize: (raw) => (JSON.parse(raw).darkMode ? 'dark' : 'light') },
      }),
    ).toBe('dark');
    expect(storage.keys()).toEqual([['settings', 'theme']]);
    expect(JSON.parse(backend.getItem(backend.key(0)!)!).expiry).toBeNull();
  });

  it.each(['valid', 'null', 'foreign', 'expired', 'invalid'])(
    'does not import over %s destinations',
    (kind) => {
      const { backend, storage } = setup();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      if (kind === 'foreign') backend.setItem('app:theme', 'foreign');
      else
        storage.setItem(
          'theme',
          kind === 'null' ? null : kind === 'invalid' ? 42 : 'light',
          kind === 'expired' ? { expiresAt: 1 } : undefined,
        );
      const deserialize = vi.fn(legacy.deserialize);
      storage.getItem('theme', { legacy: { ...legacy, deserialize }, schema });
      expect(deserialize).not.toHaveBeenCalled();
      expect(backend.getItem('old')).toBe('dark');
      warn.mockRestore();
    },
  );

  it('does not touch raw values without opt-in or when source equals destination', () => {
    const { backend, storage } = setup();
    expect(storage.getItem('theme')).toBeNull();
    expect(storage.getItem('theme', { legacy: { ...legacy, key: 'app:theme' } })).toBeNull();
    backend.setItem('app:theme', 'raw');
    expect(storage.getItem('theme', { legacy: { ...legacy, key: 'app:theme' } })).toBeNull();
    expect(backend.getItem('app:theme')).toBe('raw');
  });

  it.each(['decode', 'validation'])('preserves source on %s failure', (kind) => {
    const { backend, storage } = setup();
    expect(
      storage.getItem('theme', {
        legacy: { key: 'old', deserialize: kind === 'decode' ? JSON.parse : () => 123 },
        schema,
      }),
    ).toBeNull();
    expect(backend.getItem('old')).toBe('dark');
    expect(backend.getItem('app:theme')).toBeNull();
  });

  it('rejects async deserializers and consumes rejected promises', async () => {
    const { backend, storage } = setup();
    expect(() =>
      storage.getItem('theme', {
        legacy: { key: 'old', deserialize: () => Promise.reject(new Error('async')) },
      }),
    ).toThrow('Legacy deserialization must be synchronous');
    await Promise.resolve();
    expect(backend.getItem('old')).toBe('dark');
    expect(storage.has('theme')).toBe(false);
  });

  it.each(['read', 'write', 'cleanup', 'schema', 'serialize'])(
    'propagates %s errors and preserves the source',
    (kind) => {
      const { backend, storage } = setup();
      const fail = () => {
        throw new Error('failed');
      };
      if (kind === 'read') vi.spyOn(backend, 'getItem').mockImplementationOnce(fail);
      if (kind === 'write') vi.spyOn(backend, 'setItem').mockImplementationOnce(fail);
      if (kind === 'cleanup') vi.spyOn(backend, 'removeItem').mockImplementationOnce(fail);
      const target =
        kind === 'serialize'
          ? createCoreStorage({
              storage: backend,
              prefix: 'app',
              serializer: { parse: JSON.parse, stringify: fail },
            })
          : storage;
      expect(() =>
        target.getItem('theme', {
          legacy,
          ...(kind === 'schema'
            ? { schema: { '~standard': { version: 1 as const, vendor: 'test', validate: fail } } }
            : {}),
        }),
      ).toThrow('failed');
      expect(backend.getItem('old')).toBe('dark');
      expect(storage.has('theme')).toBe(kind === 'cleanup');
    },
  );
});
