import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';
import type { StorageChange, UltraStorage } from './types';

describe('quota recovery', () => {
  let backend: Storage;
  let storage: UltraStorage;
  let stops: (() => void)[];
  const quotaError = () => new DOMException('Storage is full', 'QuotaExceededError');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    backend = createMemoryStorage();
    storage = createStorage({
      storage: backend,
      prefix: 'cache',
      onQuotaExceeded: 'clear-expired',
    });
    stops = [];
  });

  afterEach(() => {
    for (const stop of stops) stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function expire() {
    storage.setItem('old', 'cached value', { ttl: 10 });
    vi.setSystemTime(1011);
  }

  it('leaves failed writes and expired entries untouched by default', () => {
    const defaultStorage = createStorage({ storage: backend, prefix: 'cache' });
    expire();
    const error = quotaError();
    const write = vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw error;
    });
    expect(() => defaultStorage.setItem('new', 1)).toThrow(error);
    expect(write).toHaveBeenCalledTimes(1);
    expect(backend.getItem('cache:old')).not.toBeNull();
  });

  it('does not scan or clean expired entries on a successful first write', () => {
    expire();
    const enumerate = vi.spyOn(backend, 'key');
    storage.setItem('new', 1);
    expect(enumerate).not.toHaveBeenCalled();
    expect(backend.getItem('cache:old')).not.toBeNull();
  });

  it('frees space for a large object while preserving live, foreign, and unreadable data', () => {
    const other = createStorage({ storage: backend, prefix: 'other' });
    other.setItem('old', 'keep', { ttl: 1 });
    storage.setItem('live', 1);
    storage.setItem('boundary', 2, { expiresAt: 1011 });
    backend.setItem('cache:foreign', 'external');
    backend.setItem('cache:corrupt', '{');
    backend.setItem('cache:unsupported', JSON.stringify({ __us: true, version: 2, expiry: 1 }));
    storage.setItem('old', 'x'.repeat(2000), { ttl: 10 });
    vi.setSystemTime(1011);
    const retained = [
      'other:old',
      'cache:live',
      'cache:boundary',
      'cache:foreign',
      'cache:corrupt',
      'cache:unsupported',
    ];
    const before = retained.map((key) => backend.getItem(key));
    const originalWrite = backend.setItem.bind(backend);
    const write = vi.spyOn(backend, 'setItem').mockImplementation((key, value) => {
      let size = key.length + value.length;
      for (let i = 0; i < backend.length; i++) {
        const existing = backend.key(i)!;
        if (existing !== key) size += existing.length + backend.getItem(existing)!.length;
      }
      if (size > 3000) throw quotaError();
      originalWrite(key, value);
    });
    const value = { text: 'y'.repeat(2000) };
    storage.setItem('new', value, { ttl: 500 });
    expect(write).toHaveBeenCalledTimes(2);
    expect(storage.getItem('new')).toEqual(value);
    expect(storage.getExpiration('new')).toEqual({ expiresAt: 1511 });
    expect(backend.getItem('cache:old')).toBeNull();
    expect(retained.map((key) => backend.getItem(key))).toEqual(before);
  });

  it.each([
    null,
    'QuotaExceededError',
    {},
    new Error('quota'),
    new DOMException('Denied', 'SecurityError'),
  ])('propagates non-quota backend failures without cleanup: %s', (error) => {
    expire();
    const write = vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw error;
    });
    let caught: unknown = 'not thrown';
    try {
      storage.setItem('new', 1);
    } catch (failure) {
      caught = failure;
    }
    expect(caught).toBe(error);
    expect(write).toHaveBeenCalledTimes(1);
    expect(backend.getItem('cache:old')).not.toBeNull();
  });

  it.each(['read', 'serialize'] as const)('does not recover quota-named %s failures', (kind) => {
    expire();
    const error = quotaError();
    const fail = () => {
      throw error;
    };
    const instance = createCoreStorage({
      storage: backend,
      prefix: 'cache',
      onQuotaExceeded: 'clear-expired',
      serializer: { stringify: kind === 'serialize' ? fail : JSON.stringify, parse: JSON.parse },
    });
    if (kind === 'read') vi.spyOn(backend, 'getItem').mockImplementationOnce(fail);
    const write = vi.spyOn(backend, 'setItem');
    const remove = vi.spyOn(backend, 'removeItem');
    expect(() => instance.setItem('new', 1)).toThrow(error);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('serializes once and recognizes quota errors without relying on DOMException identity', () => {
    const stringify = vi.fn(JSON.stringify);
    const instance = createCoreStorage({
      storage: backend,
      serializer: { stringify, parse: JSON.parse },
      onQuotaExceeded: 'clear-expired',
    });
    const write = vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
      vi.setSystemTime(1100);
      throw { name: 'QuotaExceededError' };
    });
    instance.setItem('new', 1, { ttl: 500 });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
    expect(stringify).toHaveBeenCalledTimes(1);
    expect(instance.getExpiration('new')).toEqual({ expiresAt: 1500 });
  });

  it.each([true, false])(
    'retries only once and throws the retry error (expired entries: %s)',
    (expired) => {
      if (expired) expire();
      storage.setItem('new', 'previous');
      const removed = vi.fn();
      const changed = vi.fn();
      stops.push(storage.subscribe('old', removed), storage.subscribe('new', changed));
      const retryError = quotaError();
      const write = vi
        .spyOn(backend, 'setItem')
        .mockImplementationOnce(() => {
          throw quotaError();
        })
        .mockImplementation(() => {
          throw retryError;
        });
      expect(() => storage.setItem('new', 'too large')).toThrow(retryError);
      expect(write).toHaveBeenCalledTimes(2);
      expect(backend.getItem('cache:old')).toBeNull();
      expect(storage.getItem('new')).toBe('previous');
      expect(removed).toHaveBeenCalledTimes(expired ? 1 : 0);
      expect(changed).not.toHaveBeenCalled();
    },
  );

  it('propagates cleanup failures without retrying or rolling back completed removals', () => {
    storage.setItem('old', 1, { ttl: 10 });
    storage.setItem('second', 2, { ttl: 10 });
    vi.setSystemTime(1011);
    const changed = vi.fn();
    stops.push(storage.subscribe('old', changed), storage.subscribe('second', changed));
    const write = vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw quotaError();
    });
    const remove = backend.removeItem.bind(backend);
    const cleanupError = new Error('cleanup failed');
    vi.spyOn(backend, 'removeItem').mockImplementation((key) => {
      if (key === 'cache:second') throw cleanupError;
      remove(key);
    });
    expect(() => storage.setItem('new', 3)).toThrow(cleanupError);
    expect(write).toHaveBeenCalledTimes(1);
    expect(backend.getItem('cache:old')).toBeNull();
    expect(backend.getItem('cache:second')).not.toBeNull();
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      key: 'old',
      type: 'expire',
      source: 'local',
    });
  });

  it('delivers cleanup and set events after retrying, so cleanup listeners see the saved value', () => {
    expire();
    const events: StorageChange[] = [];
    const values: unknown[] = [];
    stops.push(
      storage.subscribe('old', (change) => {
        events.push(change);
        values.push(storage.getItem('new'));
        storage.setItem('from-listener', 2);
      }),
      storage.subscribe('new', (change) => events.push(change)),
    );
    const write = vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
      throw quotaError();
    });
    storage.setItem('new', 1);
    expect(write.mock.calls.map(([key]) => key)).toEqual([
      'cache:new',
      'cache:new',
      'cache:from-listener',
    ]);
    expect(values).toEqual([1]);
    expect(events).toEqual([
      { key: 'old', type: 'expire', source: 'local' },
      { key: 'new', type: 'set', source: 'local' },
    ]);
  });

  it.each(['updateItem', 'getOrInit', 'setExpiration', 'legacy'] as const)(
    'recovers %s writes without rerunning user callbacks',
    (method) => {
      storage.setItem('value', 1, { ttl: 500 });
      backend.setItem('legacy', '3');
      expire();
      const callback = vi.fn(() => 3);
      const write = vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
        throw quotaError();
      });
      if (method === 'updateItem') expect(storage.updateItem('value', callback)).toBe(3);
      if (method === 'getOrInit') expect(storage.getOrInit('new', callback)).toBe(3);
      if (method === 'setExpiration')
        expect(storage.setExpiration('value', { ttl: 200 })).toBe(true);
      if (method === 'legacy')
        expect(storage.getItem('new', { legacy: { key: 'legacy', deserialize: callback } })).toBe(
          3,
        );
      expect(write).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledTimes(method === 'setExpiration' ? 0 : 1);
      expect(backend.getItem('cache:old')).toBeNull();
      expect(storage.getExpiration('value')).toEqual({
        expiresAt: method === 'setExpiration' ? 1211 : 1500,
      });
      if (method === 'legacy') expect(backend.getItem('legacy')).toBeNull();
    },
  );
});
