import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { createStorage, createMemoryStorage } from './core-entry';

describe('greatstorage/core', () => {
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
