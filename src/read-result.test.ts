import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';
import type { StorageReadResult } from './core-entry';

const schema = (
  validate: StandardSchemaV1<unknown, number>['~standard']['validate'],
): StandardSchemaV1<unknown, number> => ({ '~standard': { version: 1, vendor: 'test', validate } });

afterEach(() => vi.restoreAllMocks());

describe('getItemResult', () => {
  it('distinguishes stored null and undefined from missing, with rich values and array keys', () => {
    const storage = createStorage({ storage: createMemoryStorage(), prefix: 'app' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const value of [null, undefined, false, 0, new Map([['date', new Date(0)]])]) {
      storage.setItem(['values', '1'], value);
      expect(storage.getItemResult(['values', '1'])).toEqual({ status: 'success', value });
    }
    expect(storage.getItemResult('absent')).toEqual({ status: 'missing' });
  });

  it.each([
    'null',
    '{"value":1}',
    '{"__us":true,"version":2,"value":1,"expiry":null}',
    '{"__us":true,"version":1,"value":1,"expiry":"invalid"}',
  ])('reports unsupported data without deleting it: %s', (raw) => {
    const backend = createMemoryStorage();
    backend.setItem('key', raw);
    const storage = createStorage({ storage: backend });
    expect(storage.getItemResult('key')).toEqual({ status: 'unsupported' });
    expect(storage.getItem('key')).toBeNull();
    expect(backend.getItem('key')).toBe(raw);
  });

  it('returns the original serializer error only when JSON fallback also fails', () => {
    const backend = createMemoryStorage();
    const error = new Error('Cannot decode');
    const storage = createCoreStorage({
      storage: backend,
      serializer: {
        stringify: JSON.stringify,
        parse: () => {
          throw error;
        },
      },
    });
    backend.setItem('key', 'broken');
    expect(storage.getItemResult('key')).toEqual({ status: 'parse-error', error });
    expect(storage.getItem('key')).toBeNull();
    expect(backend.getItem('key')).toBe('broken');
    for (const marker of ['__us', '__gs']) {
      backend.setItem(
        'key',
        JSON.stringify({ [marker]: true, version: 1, value: null, expiry: null }),
      );
      expect(storage.getItemResult('key')).toEqual({ status: 'success', value: null });
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
    expect(storage.getItemResult('key')).toEqual({ status: 'success', value: 1 });
    now.mockReturnValue(201);
    const validate = vi.fn(() => ({ value: 2 }));
    expect(storage.getItemResult('key', { schema: schema(validate) })).toEqual({
      status: 'expired',
      expiresAt: 200,
    });
    expect(validate).not.toHaveBeenCalled();
    expect(backend.getItem('app:key')).toBeNull();
    expect(storage.getItemResult('key')).toEqual({ status: 'missing' });
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
    expect(storage.getItemResult('key', { schema: schema(() => ({ issues })) })).toEqual({
      status: 'validation-error',
      issues,
    });
    expect(backend.getItem('key')).toBe(raw);
    const result = storage.getItemResult('key', {
      schema: schema((value) => ({ value: Number(value) })),
    });
    expectTypeOf(result).toEqualTypeOf<StorageReadResult<number>>();
    if (result.status === 'success') expectTypeOf(result.value).toEqualTypeOf<number>();
    expect(result).toEqual({ status: 'success', value: 42 });
  });

  it('propagates backend reads, expiration cleanup failures, and thrown schema errors', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    const error = new Error('Operational failure');
    const read = vi.spyOn(backend, 'getItem').mockImplementation(() => {
      throw error;
    });
    expect(() => storage.getItemResult('key')).toThrow(error);
    read.mockRestore();
    storage.setItem('key', 1);
    expect(() =>
      storage.getItemResult('key', {
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
    expect(() => storage.getItemResult('key')).toThrow(error);
    expect(backend.getItem('key')).not.toBeNull();
  });

  it('rejects async schemas and consumes their rejections', async () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('key', 1);
    expect(() =>
      storage.getItemResult('key', {
        schema: schema(() => Promise.reject(new Error('Async failure'))),
      }),
    ).toThrow('Schema validation must be synchronous');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
