import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vite-plus/test';
import { createStorage, createMemoryStorage } from './index';
import type { UltraStorage } from './types';

describe('ultrastorage', () => {
  let storage: ReturnType<typeof createStorage>;
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMemoryStorage();
    storage = createStorage({ storage: mockStorage });
    vi.restoreAllMocks();
  });

  it('is assignable to the web Storage interface', () => {
    const webStorage: Storage = storage;

    webStorage.setItem('name', 'Alice');

    expect(webStorage.getItem('name')).toBe('Alice');
    expectTypeOf<UltraStorage>().toMatchTypeOf<Storage>();
  });

  it('uses the browser localStorage backend when none is provided', () => {
    vi.stubGlobal('localStorage', mockStorage);
    try {
      const defaultStorage = createStorage();
      defaultStorage.setItem('name', 'Alice');
      expect(storage.getItem('name')).toBe('Alice');
      storage.setItem('name', 'Bob');
      expect(defaultStorage.getItem('name')).toBe('Bob');
      defaultStorage.removeItem('name');
      expect(mockStorage.getItem('name')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('set and get', () => {
    it('stores and retrieves a string', () => {
      storage.setItem('name', 'Alice');
      expect(storage.getItem('name')).toBe('Alice');
    });

    it('stores and retrieves a number', () => {
      storage.setItem('count', 42);
      expect(storage.getItem('count')).toBe(42);
    });

    it('stores and retrieves a boolean', () => {
      storage.setItem('active', true);
      expect(storage.getItem('active')).toBe(true);
    });

    it('stores and retrieves an object', () => {
      const obj = { foo: 'bar', nested: { a: 1 } };
      storage.setItem('data', obj);
      expect(storage.getItem('data')).toEqual(obj);
    });

    it('stores and retrieves an array', () => {
      const arr = [1, 'two', { three: 3 }];
      storage.setItem('list', arr);
      expect(storage.getItem('list')).toEqual(arr);
    });

    it('stores and retrieves null value', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('empty', null);
      expect(storage.getItem('empty')).toBeNull();
      expect(storage.has('empty')).toBe(true);
    });

    it('returns null for non-existent key', () => {
      expect(storage.getItem('missing')).toBeNull();
    });
  });

  describe('TTL', () => {
    it('returns value before TTL expires', () => {
      vi.useFakeTimers();
      storage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(500);
      expect(storage.getItem('temp')).toBe('value');
      vi.useRealTimers();
    });

    it('returns null after TTL expires', () => {
      vi.useFakeTimers();
      storage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('temp')).toBeNull();
      vi.useRealTimers();
    });

    it('removes expired item from underlying storage on read', () => {
      vi.useFakeTimers();
      storage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      storage.getItem('temp');
      expect(mockStorage.getItem('temp')).toBeNull();
      vi.useRealTimers();
    });

    it('returns value before expiresAt (Date)', () => {
      vi.useFakeTimers({ now: 1000 });
      storage.setItem('temp', 'value', { expiresAt: new Date(2000) });
      vi.advanceTimersByTime(500);
      expect(storage.getItem('temp')).toBe('value');
      vi.useRealTimers();
    });

    it('returns null after expiresAt (Date)', () => {
      vi.useFakeTimers({ now: 1000 });
      storage.setItem('temp', 'value', { expiresAt: new Date(2000) });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('temp')).toBeNull();
      vi.useRealTimers();
    });

    it('returns value before expiresAt (timestamp)', () => {
      vi.useFakeTimers({ now: 1000 });
      storage.setItem('temp', 'value', { expiresAt: 2000 });
      vi.advanceTimersByTime(500);
      expect(storage.getItem('temp')).toBe('value');
      vi.useRealTimers();
    });

    it('returns null after expiresAt (timestamp)', () => {
      vi.useFakeTimers({ now: 1000 });
      storage.setItem('temp', 'value', { expiresAt: 2000 });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('temp')).toBeNull();
      vi.useRealTimers();
    });

    it('throws when both ttl and expiresAt are specified', () => {
      expect(() =>
        storage.setItem('key', 'value', { ttl: 1000, expiresAt: Date.now() + 1000 }),
      ).toThrow('Cannot specify both "ttl" and "expiresAt"');
    });

    it('persists value when no TTL is set', () => {
      vi.useFakeTimers();
      storage.setItem('permanent', 'value');
      vi.advanceTimersByTime(999_999_999);
      expect(storage.getItem('permanent')).toBe('value');
      vi.useRealTimers();
    });
  });

  describe('remove', () => {
    it('removes an existing key', () => {
      storage.setItem('key', 'value');
      storage.removeItem('key');
      expect(storage.getItem('key')).toBeNull();
    });
  });

  describe('clear', () => {
    it('continues clearing when a listed value is no longer available', () => {
      storage.setItem('missing', 1);
      storage.setItem('remaining', 2);
      // Model a backend whose listed key has no readable value during enumeration.
      vi.spyOn(mockStorage, 'getItem').mockReturnValueOnce(null);

      storage.clear();

      expect(storage.getItem('remaining')).toBeNull();
      expect(storage.getItem('missing')).toBe(1);
    });

    it('removes all ultrastorage keys', () => {
      storage.setItem('a', 1);
      storage.setItem('b', 2);
      storage.clear();
      expect(storage.getItem('a')).toBeNull();
      expect(storage.getItem('b')).toBeNull();
    });

    it('does not remove non-ultrastorage keys', () => {
      mockStorage.setItem('external', 'keep me');
      storage.setItem('a', 1);
      storage.clear();
      expect(storage.getItem('a')).toBeNull();
      expect(mockStorage.getItem('external')).toBe('keep me');
    });
  });

  describe('clearExpired', () => {
    it('removes expired entries', () => {
      vi.useFakeTimers();
      storage.setItem('temp1', 'a', { ttl: 1000 });
      storage.setItem('temp2', 'b', { ttl: 2000 });
      storage.setItem('permanent', 'c');
      vi.advanceTimersByTime(1500);
      storage.clearExpired();
      expect(storage.has('temp1')).toBe(false);
      expect(storage.has('temp2')).toBe(true);
      expect(storage.getItem('permanent')).toBe('c');
      vi.useRealTimers();
    });

    it('does not remove non-ultrastorage entries', () => {
      vi.useFakeTimers();
      mockStorage.setItem('external', 'keep me');
      storage.setItem('temp', 'a', { ttl: 1000 });
      vi.advanceTimersByTime(1500);
      storage.clearExpired();
      expect(mockStorage.getItem('external')).toBe('keep me');
      vi.useRealTimers();
    });

    it('does nothing when no entries are expired', () => {
      vi.useFakeTimers();
      storage.setItem('a', 'value', { ttl: 5000 });
      storage.setItem('b', 'value');
      storage.clearExpired();
      expect(storage.has('a')).toBe(true);
      expect(storage.has('b')).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('has', () => {
    it('returns true for existing key', () => {
      storage.setItem('key', 'value');
      expect(storage.has('key')).toBe(true);
    });

    it('returns false for missing key', () => {
      expect(storage.has('missing')).toBe(false);
    });

    it('returns false for expired key', () => {
      vi.useFakeTimers();
      storage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(storage.has('temp')).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('length', () => {
    it('skips unavailable backend keys and continues counting readable entries', () => {
      storage.setItem('missing', 1);
      storage.setItem('remaining', 2);
      vi.spyOn(mockStorage, 'key').mockReturnValueOnce(null);

      expect(storage.length).toBe(1);
      expect(storage.getItem('remaining')).toBe(2);
    });

    it('returns 0 when empty', () => {
      expect(storage.length).toBe(0);
    });

    it('returns the number of stored entries', () => {
      storage.setItem('a', 1);
      storage.setItem('b', 2);
      storage.setItem('c', 3);
      expect(storage.length).toBe(3);
    });

    it('decreases after removing an entry', () => {
      storage.setItem('a', 1);
      storage.setItem('b', 2);
      storage.removeItem('a');
      expect(storage.length).toBe(1);
    });

    it('returns 0 after clear', () => {
      storage.setItem('a', 1);
      storage.setItem('b', 2);
      storage.clear();
      expect(storage.length).toBe(0);
    });

    it('excludes expired entries', () => {
      vi.useFakeTimers();
      storage.setItem('temp', 'a', { ttl: 1000 });
      storage.setItem('permanent', 'b');
      vi.advanceTimersByTime(1001);
      expect(storage.length).toBe(1);
      vi.useRealTimers();
    });

    it('does not count non-ultrastorage entries', () => {
      mockStorage.setItem('external', 'value');
      storage.setItem('internal', 'value');
      expect(storage.length).toBe(1);
    });

    it('only counts entries with the matching prefix', () => {
      const nsStorage = createStorage({ storage: mockStorage, prefix: 'app' });
      nsStorage.setItem('a', 1);
      nsStorage.setItem('b', 2);
      storage.setItem('c', 3);
      expect(nsStorage.length).toBe(2);
    });
  });

  describe('key', () => {
    it('returns the key at the given index', () => {
      storage.setItem('a', 1);
      storage.setItem('b', 2);
      expect(storage.key(0)).toBe('a');
      expect(storage.key(1)).toBe('b');
    });

    it('returns null for out-of-bounds index', () => {
      storage.setItem('a', 1);
      expect(storage.key(1)).toBeNull();
      expect(storage.key(-1)).toBeNull();
    });

    it('returns null when storage is empty', () => {
      expect(storage.key(0)).toBeNull();
    });

    it('skips expired entries', () => {
      vi.useFakeTimers();
      storage.setItem('expired', 'x', { ttl: 100 });
      storage.setItem('valid', 'y');
      vi.advanceTimersByTime(200);
      expect(storage.key(0)).toBe('valid');
      expect(storage.key(1)).toBeNull();
      vi.useRealTimers();
    });

    it('returns unprefixed keys for namespaced storage', () => {
      const nsStorage = createStorage({ storage: mockStorage, prefix: 'app' });
      nsStorage.setItem('foo', 1);
      expect(nsStorage.key(0)).toBe('foo');
    });

    it('skips non-ultrastorage entries', () => {
      mockStorage.setItem('external', 'raw');
      storage.setItem('internal', 'value');
      expect(storage.key(0)).toBe('internal');
      expect(storage.key(1)).toBeNull();
    });
  });

  describe('getOrInit', () => {
    it('returns factory value when key is missing', () => {
      const result = storage.getOrInit('key', () => 'created');
      expect(result).toBe('created');
    });

    it('persists the factory value to storage', () => {
      storage.getOrInit('key', () => 'created');
      expect(storage.getItem('key')).toBe('created');
    });

    it('returns existing value without calling factory', () => {
      storage.setItem('key', 'existing');
      const factory = vi.fn(() => 'new');
      const result = storage.getOrInit('key', factory);
      expect(result).toBe('existing');
      expect(factory).not.toHaveBeenCalled();
    });

    it('calls factory when value has expired', () => {
      vi.useFakeTimers();
      storage.setItem('key', 'old', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      const result = storage.getOrInit('key', () => 'refreshed');
      expect(result).toBe('refreshed');
      expect(storage.getItem('key')).toBe('refreshed');
      vi.useRealTimers();
    });

    it('applies TTL to the factory value', () => {
      vi.useFakeTimers();
      storage.getOrInit('key', () => 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('key')).toBeNull();
      vi.useRealTimers();
    });

    it('applies expiresAt to the factory value', () => {
      vi.useFakeTimers({ now: 1000 });
      storage.getOrInit('key', () => 'value', { expiresAt: 2000 });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('key')).toBeNull();
      vi.useRealTimers();
    });

    it('works with complex types', () => {
      const result = storage.getOrInit('set', () => new Set([1, 2, 3]));
      expect(result).toBeInstanceOf(Set);
      expect(result).toEqual(new Set([1, 2, 3]));
    });
  });

  describe('updateItem', () => {
    it('updates an existing value', () => {
      storage.setItem('count', 1);
      const result = storage.updateItem<number>('count', (v) => (v ?? 0) + 1);
      expect(result).toBe(2);
      expect(storage.getItem('count')).toBe(2);
    });

    it('receives null for missing key', () => {
      const result = storage.updateItem<number>('count', (v) => (v ?? 0) + 10);
      expect(result).toBe(10);
      expect(storage.getItem('count')).toBe(10);
    });

    it('receives null for expired key', () => {
      vi.useFakeTimers();
      storage.setItem('count', 5, { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      const result = storage.updateItem<number>('count', (v) => (v ?? 0) + 1);
      expect(result).toBe(1);
      vi.useRealTimers();
    });

    it('applies TTL to the updated value', () => {
      vi.useFakeTimers();
      storage.updateItem('key', () => 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('key')).toBeNull();
      vi.useRealTimers();
    });

    it('works with complex types', () => {
      storage.setItem('tags', new Set(['a']));
      const result = storage.updateItem<Set<string>>('tags', (s) => {
        const next = new Set(s ?? []);
        next.add('b');
        return next;
      });
      expect(result).toEqual(new Set(['a', 'b']));
    });
  });

  describe('rich types', () => {
    it('stores and retrieves a Set', () => {
      const set = new Set([1, 2, 3]);
      storage.setItem('set', set);
      const result = storage.getItem<Set<number>>('set');
      expect(result).toBeInstanceOf(Set);
      expect(result).toEqual(set);
    });

    it('stores and retrieves a Map', () => {
      const map = new Map<string, number>([
        ['a', 1],
        ['b', 2],
      ]);
      storage.setItem('map', map);
      const result = storage.getItem<Map<string, number>>('map');
      expect(result).toBeInstanceOf(Map);
      expect(result).toEqual(map);
    });

    it('stores and retrieves a Date', () => {
      const date = new Date('2025-01-15T12:00:00.000Z');
      storage.setItem('date', date);
      const result = storage.getItem<Date>('date');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe(date.toISOString());
    });

    it('stores and retrieves a RegExp', () => {
      const regex = /foo bar/gi;
      storage.setItem('regex', regex);
      const result = storage.getItem<RegExp>('regex');
      expect(result).toBeInstanceOf(RegExp);
      expect(result!.source).toBe(regex.source);
      expect(result!.flags).toBe(regex.flags);
    });

    it('stores and retrieves undefined', () => {
      storage.setItem('undef', undefined);
      expect(storage.getItem('undef')).toBeUndefined();
    });

    it('handles nested rich types in objects', () => {
      const data = {
        tags: new Set(['a', 'b']),
        metadata: new Map([['created', new Date('2025-01-01')]]),
      };
      storage.setItem('complex', data);
      const result = storage.getItem<typeof data>('complex');
      expect(result!.tags).toBeInstanceOf(Set);
      expect(result!.tags).toEqual(data.tags);
      expect(result!.metadata).toBeInstanceOf(Map);
      expect(result!.metadata.get('created')).toBeInstanceOf(Date);
    });

    it('stores and retrieves BigInt', () => {
      storage.setItem('big', BigInt('9007199254740993'));
      expect(storage.getItem('big')).toBe(BigInt('9007199254740993'));
    });

    it('stores and retrieves NaN', () => {
      storage.setItem('nan', NaN);
      expect(storage.getItem<number>('nan')).toBeNaN();
    });

    it('stores and retrieves Infinity and -Infinity', () => {
      storage.setItem('inf', Infinity);
      storage.setItem('ninf', -Infinity);
      expect(storage.getItem('inf')).toBe(Infinity);
      expect(storage.getItem('ninf')).toBe(-Infinity);
    });

    it('stores and retrieves negative zero', () => {
      storage.setItem('nz', -0);
      expect(Object.is(storage.getItem('nz'), -0)).toBe(true);
    });
  });

  describe('coexistence with non-ultrastorage entries', () => {
    it('returns null for raw strings not set by ultrastorage', () => {
      mockStorage.setItem('raw', 'just a string');
      expect(storage.getItem('raw')).toBeNull();
    });

    it('returns null for JSON values not set by ultrastorage', () => {
      mockStorage.setItem('obj', JSON.stringify({ hello: 'world' }));
      expect(storage.getItem('obj')).toBeNull();
    });

    it('has returns false for non-ultrastorage entries', () => {
      mockStorage.setItem('external', 'value');
      expect(storage.has('external')).toBe(false);
    });

    it('does not interfere with non-ultrastorage entries in underlying storage', () => {
      mockStorage.setItem('external', 'keep me');
      storage.setItem('internal', 'managed');
      expect(mockStorage.getItem('external')).toBe('keep me');
      expect(storage.getItem('internal')).toBe('managed');
    });
  });

  describe('namespacing', () => {
    let nsStorage: ReturnType<typeof createStorage>;

    beforeEach(() => {
      nsStorage = createStorage({ storage: mockStorage, prefix: 'app' });
    });

    it('stores keys with the prefix', () => {
      nsStorage.setItem('key', 'value');
      expect(mockStorage.getItem('app:key')).not.toBeNull();
      expect(mockStorage.getItem('key')).toBeNull();
    });

    it('retrieves values using unprefixed key', () => {
      nsStorage.setItem('key', { a: 1 });
      expect(nsStorage.getItem('key')).toEqual({ a: 1 });
    });

    it('does not see keys from other namespaces', () => {
      const otherStorage = createStorage({ storage: mockStorage, prefix: 'other' });
      nsStorage.setItem('key', 'from-app');
      otherStorage.setItem('key', 'from-other');
      expect(nsStorage.getItem('key')).toBe('from-app');
      expect(otherStorage.getItem('key')).toBe('from-other');
    });

    it('remove only removes the prefixed key', () => {
      mockStorage.setItem('key', '"unprefixed"');
      nsStorage.setItem('key', 'prefixed');
      nsStorage.removeItem('key');
      expect(nsStorage.getItem('key')).toBeNull();
      expect(mockStorage.getItem('key')).toBe('"unprefixed"');
    });

    it('clear only removes keys with the prefix', () => {
      mockStorage.setItem('other', '"keep me"');
      nsStorage.setItem('a', 1);
      nsStorage.setItem('b', 2);
      nsStorage.clear();
      expect(nsStorage.getItem('a')).toBeNull();
      expect(nsStorage.getItem('b')).toBeNull();
      expect(mockStorage.getItem('other')).toBe('"keep me"');
    });

    it('has respects the prefix', () => {
      nsStorage.setItem('key', 'value');
      expect(nsStorage.has('key')).toBe(true);
      expect(storage.has('key')).toBe(false);
    });

    it('TTL works with prefix', () => {
      vi.useFakeTimers();
      nsStorage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(nsStorage.getItem('temp')).toBeNull();
      expect(mockStorage.getItem('app:temp')).toBeNull();
      vi.useRealTimers();
    });

    it('uses custom separator', () => {
      const s = createStorage({ storage: mockStorage, prefix: 'ns', separator: '/' });
      s.setItem('key', 'value');
      expect(mockStorage.getItem('ns/key')).not.toBeNull();
      expect(s.getItem('key')).toBe('value');
    });

    it('uses empty separator', () => {
      const s = createStorage({ storage: mockStorage, prefix: 'ns', separator: '' });
      s.setItem('key', 'value');
      expect(mockStorage.getItem('nskey')).not.toBeNull();
    });
  });

  describe('schema validation', () => {
    function createSchema<T>(validate: (value: unknown) => T | null) {
      return {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate(value: unknown) {
            const result = validate(value);
            if (result !== null) {
              return { value: result };
            }
            return { issues: [{ message: 'Validation failed' }] };
          },
        },
      };
    }

    const stringSchema = createSchema((v) => (typeof v === 'string' ? v : null));

    const numberSchema = createSchema((v) => (typeof v === 'number' ? v : null));

    const objectSchema = createSchema((v) =>
      typeof v === 'object' &&
      v !== null &&
      'name' in v &&
      typeof (v as Record<string, unknown>).name === 'string'
        ? (v as { name: string })
        : null,
    );

    it('returns the value when schema validation passes', () => {
      storage.setItem('name', 'Alice');
      expect(storage.getItem('name', { schema: stringSchema })).toBe('Alice');
    });

    it('returns null when schema validation fails', () => {
      storage.setItem('count', 42);
      expect(storage.getItem('count', { schema: stringSchema })).toBeNull();
    });

    it('validates numbers', () => {
      storage.setItem('count', 42);
      expect(storage.getItem('count', { schema: numberSchema })).toBe(42);
    });

    it('returns null for number schema with string value', () => {
      storage.setItem('name', 'Alice');
      expect(storage.getItem('name', { schema: numberSchema })).toBeNull();
    });

    it('validates objects', () => {
      storage.setItem('user', { name: 'Alice' });
      expect(storage.getItem('user', { schema: objectSchema })).toEqual({
        name: 'Alice',
      });
    });

    it('returns null for invalid objects', () => {
      storage.setItem('user', { age: 30 });
      expect(storage.getItem('user', { schema: objectSchema })).toBeNull();
    });

    it('returns null for non-existent key regardless of schema', () => {
      expect(storage.getItem('missing', { schema: stringSchema })).toBeNull();
    });

    it('returns the transformed value from schema validation', () => {
      const coercingSchema = createSchema((v) => (typeof v === 'string' ? v.toUpperCase() : null));
      storage.setItem('name', 'alice');
      expect(storage.getItem('name', { schema: coercingSchema })).toBe('ALICE');
    });

    it('throws on async schema validation', () => {
      const asyncSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate(_value: unknown) {
            return Promise.resolve({ value: 'ok' });
          },
        },
      };
      storage.setItem('key', 'value');
      expect(() => storage.getItem('key', { schema: asyncSchema })).toThrow(
        'Schema validation must be synchronous',
      );
    });

    it('respects TTL with schema validation', () => {
      vi.useFakeTimers();
      storage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(1001);
      expect(storage.getItem('temp', { schema: stringSchema })).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('development warnings', () => {
    // Each test uses unique key names to avoid collisions with the
    // module-level warned set which deduplicates across the process.

    it('warns when storing null', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-null', null);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]![0]).toContain('Storing `null`');
      expect(spy.mock.calls[0]![0]).toContain('"warn-null"');
    });

    it('warns when TTL is already expired', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-ttl', 'value', { ttl: -1000 });
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]![0]).toContain('expiry already in the past');
    });

    it('warns when expiresAt is in the past', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-expires', 'value', { expiresAt: Date.now() - 1000 });
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]![0]).toContain('expiry already in the past');
    });

    it('warns when getOrInit factory returns null', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.getOrInit('warn-init', () => null);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('`getOrInit()` factory'));
      expect(spy.mock.calls[0]![0]).toContain('"warn-init"');
    });

    it('does not warn for normal setItem', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-ok', 'value');
      expect(spy).not.toHaveBeenCalled();
    });

    it('does not warn for valid TTL', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-ok-ttl', 'value', { ttl: 5000 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('warns only once per key for repeated null stores', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-dedup-null', null);
      storage.setItem('warn-dedup-null', null);
      storage.setItem('warn-dedup-null', null);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('warns only once per key for repeated past-expiry stores', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-dedup-expiry', 'a', { ttl: -1 });
      storage.setItem('warn-dedup-expiry', 'b', { ttl: -1 });
      expect(spy).toHaveBeenCalledOnce();
    });

    it('warns only once per key for repeated getOrInit with null factory', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.getOrInit('warn-dedup-init', () => null);
      storage.getOrInit('warn-dedup-init', () => null);
      storage.getOrInit('warn-dedup-init', () => null);
      // getOrInit warns once, and the setItem null warning fires once too
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('warns separately for different keys', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      storage.setItem('warn-diff-a', null);
      storage.setItem('warn-diff-b', null);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('custom serializer', () => {
    it('uses a custom serializer for set and get', () => {
      const customSerializer = {
        stringify: (value: unknown) => JSON.stringify(value),
        parse: (raw: string) => JSON.parse(raw),
      };
      const customStorage = createStorage({
        storage: mockStorage,
        serializer: customSerializer,
      });
      customStorage.setItem('key', { hello: 'world' });
      expect(customStorage.getItem('key')).toEqual({ hello: 'world' });
    });

    it('custom serializer is used for writing', () => {
      const calls: unknown[] = [];
      const customSerializer = {
        stringify: (value: unknown) => {
          calls.push(value);
          return JSON.stringify(value);
        },
        parse: (raw: string) => JSON.parse(raw),
      };
      const customStorage = createStorage({
        storage: mockStorage,
        serializer: customSerializer,
      });
      customStorage.setItem('key', 'value');
      expect(calls.length).toBe(1);
    });

    it('TTL works with custom serializer', () => {
      vi.useFakeTimers();
      const customSerializer = {
        stringify: (value: unknown) => JSON.stringify(value),
        parse: (raw: string) => JSON.parse(raw),
      };
      const customStorage = createStorage({
        storage: mockStorage,
        serializer: customSerializer,
      });
      customStorage.setItem('temp', 'value', { ttl: 1000 });
      vi.advanceTimersByTime(500);
      expect(customStorage.getItem('temp')).toBe('value');
      vi.advanceTimersByTime(501);
      expect(customStorage.getItem('temp')).toBeNull();
      vi.useRealTimers();
    });
  });
});
