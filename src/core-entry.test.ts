import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { stringify, parse } from 'devalue';
import { createStorage, createMemoryStorage } from './core-entry';

describe('ultrastorage/core', () => {
  let mockStorage: Storage;
  const jsonSerializer = {
    stringify: (value: unknown) => JSON.stringify(value),
    parse: (raw: string) => JSON.parse(raw),
  };

  beforeEach(() => {
    mockStorage = createMemoryStorage();
    vi.restoreAllMocks();
  });

  it('works with a custom serializer', () => {
    const storage = createStorage({
      storage: mockStorage,
      serializer: jsonSerializer,
    });
    storage.setItem('key', { hello: 'world' });
    expect(storage.getItem('key')).toEqual({ hello: 'world' });
  });

  it('rejects successfully parsed foreign data without removing it', () => {
    const storage = createStorage({ storage: mockStorage, serializer: jsonSerializer });
    const raw = JSON.stringify({ value: 'foreign', version: 1, expiry: null });
    mockStorage.setItem('key', raw);

    expect(storage.has('key')).toBe(false);
    expect(storage.getItem('key')).toBeNull();
    expect(mockStorage.getItem('key')).toBe(raw);
  });

  it.each([
    ['JSON', jsonSerializer],
    ['devalue', { stringify, parse }],
  ] as const)('supports legacy entries with %s and writes the new marker', (_, serializer) => {
    const storage = createStorage({ storage: mockStorage, serializer, prefix: 'app' });
    const legacy = serializer.stringify({ __gs: true, version: 1, value: 'old', expiry: null });
    mockStorage.setItem('app:legacy', legacy);
    mockStorage.setItem('other:legacy', legacy);
    mockStorage.setItem(
      'app:expired',
      serializer.stringify({ __gs: true, version: 1, value: 'expired', expiry: Date.now() - 1 }),
    );
    mockStorage.setItem(
      'app:foreign',
      serializer.stringify({
        __us: false,
        __gs: false,
        version: 1,
        value: 'foreign',
        expiry: null,
      }),
    );

    expect(storage.getItem('legacy')).toBe('old');
    expect(storage.has('legacy')).toBe(true);
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('legacy');
    expect(mockStorage.getItem('app:legacy')).toBe(legacy);
    expect(storage.has('expired')).toBe(false);
    expect(storage.getItem('foreign')).toBeNull();
    storage.clearExpired();
    expect(mockStorage.getItem('app:expired')).toBeNull();

    storage.setItem('new', 'new');
    expect(serializer.parse(mockStorage.getItem('app:new')!)).toEqual({
      __us: true,
      version: 1,
      value: 'new',
      expiry: null,
    });
    storage.clear();
    expect(mockStorage.getItem('app:legacy')).toBeNull();
    expect(mockStorage.getItem('app:new')).toBeNull();
    expect(mockStorage.getItem('other:legacy')).toBe(legacy);
    expect(mockStorage.getItem('app:foreign')).not.toBeNull();
  });

  it('uses the provided serializer for writing', () => {
    const calls: unknown[] = [];
    const storage = createStorage({
      storage: mockStorage,
      serializer: {
        stringify: (value: unknown) => {
          calls.push(value);
          return JSON.stringify(value);
        },
        parse: (raw: string) => JSON.parse(raw),
      },
    });
    storage.setItem('key', 'value');
    expect(calls.length).toBe(1);
  });

  it('supports TTL with a custom serializer', () => {
    vi.useFakeTimers();
    const storage = createStorage({
      storage: mockStorage,
      serializer: jsonSerializer,
    });
    storage.setItem('temp', 'value', { ttl: 1000 });
    vi.advanceTimersByTime(500);
    expect(storage.getItem('temp')).toBe('value');
    vi.advanceTimersByTime(501);
    expect(storage.getItem('temp')).toBeNull();
    vi.useRealTimers();
  });

  it('supports prefix with a custom serializer', () => {
    const storage = createStorage({
      storage: mockStorage,
      prefix: 'app',
      serializer: jsonSerializer,
    });
    storage.setItem('key', 'value');
    expect(mockStorage.getItem('app:key')).not.toBeNull();
    expect(storage.getItem('key')).toBe('value');
  });
});
