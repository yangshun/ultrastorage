import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from '../index';
import { createStorage as createCoreStorage } from '../core-entry';
import type { StorageReadResult } from '../core-entry';

const schema = (
  validate: StandardSchemaV1<unknown, number>['~standard']['validate'],
): StandardSchemaV1<unknown, number> => ({ '~standard': { version: 1, vendor: 'test', validate } });

afterEach(() => vi.restoreAllMocks());

describe('getItem detailed results', () => {
  it('uses the requested mode without interpreting result-like payloads', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    const value = { __result: true, status: 'success', value: 123, migrated: true };
    storage.setItem('result-like', value);
    expect(storage.getItem('result-like')).toEqual(value);
    expect(storage.getItem('result-like', { detailed: false })).toEqual(value);
    expect(storage.getItem('result-like', { detailed: true })).toEqual({
      __result: true,
      status: 'success',
      value,
    });
    expect('getItemResult' in storage).toBe(false);
  });

  it('infers plain and detailed return types, including dynamic flags', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    expectTypeOf(storage.getItem<string>('key')).toEqualTypeOf<string | null>();
    expectTypeOf(storage.getItem<string>('key', { detailed: false })).toEqualTypeOf<
      string | null
    >();
    expectTypeOf(storage.getItem<string>('key', { detailed: true })).toEqualTypeOf<
      StorageReadResult<string>
    >();
    const detailed = Boolean(Date.now());
    expectTypeOf(storage.getItem<string>('key', { detailed })).toEqualTypeOf<
      string | null | StorageReadResult<string>
    >();
  });

  it('distinguishes stored null and undefined from missing, with rich values and array keys', () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'app' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [null, undefined, false, 0, new Map([['date', new Date(0)]])]) {
      storage.setItem(['values', '1'], value);
      expect(storage.getItem(['values', '1'], { detailed: true })).toEqual({
        __result: true,
        status: 'success',
        value,
      });
    }
    expect(storage.getItem('absent', { detailed: true })).toEqual({
      __result: true,
      status: 'missing',
    });
  });

  it.each([
    'null',
    '{"value":1}',
    '{"__us":true,"version":2,"value":1,"expiry":null}',
    '{"__us":true,"version":1,"value":1,"expiry":"invalid"}',
  ])('reports unsupported data without deleting it: %s', (raw) => {
    const backend = createMemoryStorage();
    backend.setItem('key', raw);
    const storage = createStorage({ storage: backend, serializer: JSON });
    expect(storage.getItem('key', { detailed: true })).toEqual({
      __result: true,
      status: 'unsupported',
    });
    expect(storage.getItem('key')).toBeNull();
    expect(backend.getItem('key')).toBe(raw);
  });

  it('retains the original serializer error when explicit JSON fallback also fails', () => {
    const backend = createMemoryStorage();
    const error = new Error('Cannot decode');
    const storage = createCoreStorage({
      storage: backend,
      fallbackParser: JSON.parse,
      serializer: {
        stringify: JSON.stringify,
        parse: () => {
          throw error;
        },
      },
    });
    backend.setItem('key', 'broken');
    expect(storage.getItem('key', { detailed: true })).toEqual({
      __result: true,
      status: 'parse-error',
      error,
    });
    expect(storage.getItem('key')).toBeNull();
    expect(backend.getItem('key')).toBe('broken');
    for (const marker of ['__us', '__gs']) {
      backend.setItem(
        'key',
        JSON.stringify({ [marker]: true, version: 1, value: null, expiry: null }),
      );
      expect(storage.getItem('key', { detailed: true })).toEqual({
        __result: true,
        status: 'success',
        value: null,
      });
    }
  });

  it('cleans up only after the deadline and emits one expiration event before becoming missing', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend, prefix: 'app' });
    const other = createStorage({ storage: backend, prefix: 'app' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    storage.setItem('key', 1, { expiresAt: 200 });
    const listener = vi.fn();
    const unsubscribe = other.subscribe('key', listener);
    now.mockReturnValue(200);
    expect(storage.getItem('key', { detailed: true })).toEqual({
      __result: true,
      status: 'success',
      value: 1,
    });
    now.mockReturnValue(201);
    const validate = vi.fn(() => ({ value: 2 }));
    expect(storage.getItem('key', { detailed: true, schema: schema(validate) })).toEqual({
      __result: true,
      status: 'expired',
      expiresAt: 200,
    });
    expect(validate).not.toHaveBeenCalled();
    expect(backend.getItem('app:key')).toBeNull();
    expect(storage.getItem('key', { detailed: true })).toEqual({
      __result: true,
      status: 'missing',
    });
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      key: 'key',
      type: 'expire',
      source: 'local',
    });
    unsubscribe();
  });

  it('exposes validation issues, preserves data, and infers transformed output', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('key', '42');
    const raw = backend.getItem('key');
    const issues = [{ message: 'Expected a number', path: ['count'] }];
    expect(storage.getItem('key', { detailed: true, schema: schema(() => ({ issues })) })).toEqual({
      __result: true,
      status: 'validation-error',
      issues,
    });
    expect(backend.getItem('key')).toBe(raw);
    const result = storage.getItem('key', {
      detailed: true,
      schema: schema((value) => ({ value: Number(value) })),
    });
    expectTypeOf(result).toEqualTypeOf<StorageReadResult<number>>();
    if (result.status === 'success') expectTypeOf(result.value).toEqualTypeOf<number>();
    expect(result).toEqual({ __result: true, status: 'success', value: 42 });
  });

  it('propagates backend reads, expiration cleanup failures, and thrown schema errors', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    const error = new Error('Operational failure');
    const read = vi.spyOn(backend, 'getItem').mockImplementation(() => {
      throw error;
    });
    expect(() => storage.getItem('key', { detailed: true })).toThrow(error);
    read.mockRestore();
    storage.setItem('key', 1);
    expect(() =>
      storage.getItem('key', {
        detailed: true,
        schema: schema(() => {
          throw error;
        }),
      }),
    ).toThrow(error);
    vi.spyOn(Date, 'now').mockReturnValue(100);
    storage.setItem('key', 1, { expiresAt: 101 });
    vi.spyOn(Date, 'now').mockReturnValue(102);
    vi.spyOn(backend, 'removeItem').mockImplementation(() => {
      throw error;
    });
    expect(() => storage.getItem('key', { detailed: true })).toThrow(error);
    expect(backend.getItem('key')).not.toBeNull();
  });

  it('rejects async schemas and consumes their rejections', async () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('key', 1);
    expect(() =>
      storage.getItem('key', {
        detailed: true,
        schema: schema(() => Promise.reject(new Error('Async failure'))),
      }),
    ).toThrow('Schema validation must be synchronous');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('detailed importing reads', () => {
  it('marks a verified import, preserves expiration, and omits migrated on subsequent reads', () => {
    vi.useFakeTimers({ now: 1000 });
    try {
      const backend = createMemoryStorage();
      backend.setItem('old', '{"value":"draft","expiry":2000}');
      const storage = createStorage({ storage: backend, prefix: 'app' });
      const options = {
        detailed: true as const,
        migrateFrom: {
          key: 'old',
          deserialize: (raw: string) => {
            const old = JSON.parse(raw);
            return { value: old.value, options: { expiresAt: old.expiry } };
          },
        },
      };
      expect(storage.getItem('draft', options)).toEqual({
        __result: true,
        status: 'success',
        value: 'draft',
        migrated: true,
      });
      expect(storage.getExpiration('draft')).toEqual({ expiresAt: 2000 });
      expect(backend.getItem('old')).toBe('{"value":"draft","expiry":2000}');
      expect(storage.getItem('draft', options)).toEqual({
        __result: true,
        status: 'success',
        value: 'draft',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports missing, expired, invalid, and decoder-failed imports without a migration flag', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    const migrateFrom = { key: 'old', deserialize: (raw: string) => ({ value: raw }) };
    expect(storage.getItem('draft', { detailed: true, migrateFrom })).toEqual({
      __result: true,
      status: 'missing',
    });
    backend.setItem('old', 'draft');
    expect(
      storage.getItem('draft', {
        detailed: true,
        migrateFrom: {
          ...migrateFrom,
          deserialize: () => ({ value: 'draft', options: { expiresAt: 0 } }),
        },
      }),
    ).toEqual({ __result: true, status: 'expired', expiresAt: 0 });
    const error = new Error('decode');
    expect(
      storage.getItem('draft', {
        detailed: true,
        migrateFrom: {
          ...migrateFrom,
          deserialize: () => {
            throw error;
          },
        },
      }),
    ).toEqual({ __result: true, status: 'parse-error', error });
    const issues = [{ message: 'Bad source' }];
    expect(
      storage.getItem('draft', { detailed: true, migrateFrom, schema: schema(() => ({ issues })) }),
    ).toEqual({ __result: true, status: 'validation-error', issues });
    expect(backend.getItem('old')).toBe('draft');
    expect(backend.getItem('draft')).toBeNull();
  });

  it('does not report reentrant destination writes as imports', () => {
    const backend = createMemoryStorage();
    backend.setItem('old', 'source');
    const storage = createStorage({ storage: backend });
    expect(
      storage.getItem('draft', {
        detailed: true,
        migrateFrom: {
          key: 'old',
          deserialize: (raw) => {
            storage.setItem('draft', 'newer');
            return { value: raw };
          },
        },
      }),
    ).toEqual({ __result: true, status: 'success', value: 'newer' });
    expect(backend.getItem('old')).toBe('source');
  });

  it('never reports success when an import write fails', () => {
    const backend = createMemoryStorage();
    backend.setItem('old', 'source');
    const storage = createStorage({ storage: backend });
    const error = new Error('quota');
    vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
      throw error;
    });
    expect(() =>
      storage.getItem('draft', {
        detailed: true,
        migrateFrom: { key: 'old', deserialize: (raw) => ({ value: raw }) },
      }),
    ).toThrow(error);
    expect(backend.getItem('old')).toBe('source');
  });
});

describe('async parser contract', () => {
  it('rejects a resolved async parser with a synchronous TypeError', async () => {
    const backend = createMemoryStorage();
    backend.setItem('key', 'encoded');
    const storage = createCoreStorage({
      storage: backend,
      serializer: {
        stringify: JSON.stringify,
        parse: async () => ({ __us: true, version: 1, value: 'decoded', expiry: null }),
      },
    });
    expect(() => storage.getItem('key', { detailed: true })).toThrow(
      'Serializer parse must be synchronous',
    );
    expect(backend.getItem('key')).toBe('encoded');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('rejects a rejected async parser and consumes the rejection', async () => {
    const backend = createMemoryStorage();
    backend.setItem('key', 'encoded');
    const storage = createCoreStorage({
      storage: backend,
      serializer: {
        stringify: JSON.stringify,
        parse: () => Promise.reject(new Error('decode failed')),
      },
    });
    expect(() => storage.getItem('key', { detailed: true })).toThrow(
      'Serializer parse must be synchronous',
    );
    expect(backend.getItem('key')).toBe('encoded');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('supports explicit JSON fallback for synchronous parser exceptions', () => {
    const backend = createMemoryStorage();
    backend.setItem('key', JSON.stringify({ __us: true, version: 1, value: 1, expiry: null }));
    const storage = createCoreStorage({
      storage: backend,
      fallbackParser: JSON.parse,
      serializer: {
        stringify: JSON.stringify,
        parse: () => {
          throw new Error('Cannot decode');
        },
      },
    });
    expect(storage.getItem('key', { detailed: true })).toEqual({
      __result: true,
      status: 'success',
      value: 1,
    });
  });
});
