import { parse } from 'devalue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';
import type { ExpirationOptions } from './index';

describe('expiration controls', () => {
  const now = 10_000;
  let backend: Storage;
  let storage: ReturnType<typeof createStorage>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    backend = createMemoryStorage();
    storage = createStorage({ storage: backend, prefix: 'app' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('inspects stored deadlines even after expiration, until cleanup removes the entry', () => {
    storage.setItem('draft', { title: 'Hello' }, { ttl: 100 });
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: now + 100 });
    vi.setSystemTime(now + 100);
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: now + 100 });
    const listener = vi.fn();
    storage.subscribe('draft', listener);
    vi.setSystemTime(now + 101);
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: now + 100 });
    expect(storage.has('draft')).toBe(false);
    expect(storage.setExpiration('draft', { ttl: 100 })).toBe(false);
    expect(backend.getItem('app:draft')).not.toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(storage.getItem('draft')).toBeNull();
    expect(storage.getExpiration('draft')).toBeNull();
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      key: 'draft',
      type: 'expire',
      source: 'local',
    });
    storage.setItem('permanent', 1);
    expect(storage.getExpiration('permanent')).toEqual({ expiresAt: null });
  });

  it.each([
    null,
    'not json',
    JSON.stringify({ value: 1 }),
    JSON.stringify({ __us: true, version: 2, value: 1, expiry: null }),
  ])('leaves missing and unreadable entries untouched: %s', (raw) => {
    if (raw !== null) backend.setItem('app:draft', raw);
    expect(storage.getExpiration('draft')).toBeNull();
    expect(storage.setExpiration('draft', null)).toBe(false);
    expect(backend.getItem('app:draft')).toBe(raw);
  });

  it('changes and removes expiration for array keys while preserving rich values', () => {
    const key = ['drafts', '1'];
    const value = new Map([['saved', new Date(now)]]);
    storage.setItem(key, value);
    expect(storage.setExpiration(key, { ttl: 200 })).toBe(true);
    vi.setSystemTime(now + 50);
    expect(storage.setExpiration(key, { ttl: 200 })).toBe(true);
    expect(storage.getExpiration(key)).toEqual({ expiresAt: now + 250 });
    expect(storage.setExpiration(key, { expiresAt: new Date(now + 300) })).toBe(true);
    expect(storage.getItem(key)).toEqual(value);
    expect(storage.setExpiration(key, null)).toBe(true);
    expect(storage.getExpiration(key)).toEqual({ expiresAt: null });
    expect(createStorage({ storage: backend, prefix: 'other' }).getExpiration(key)).toBeNull();
  });

  it('notifies shared instances only on changes, and keeps expiration lazy', () => {
    storage.setItem('draft', 1, { ttl: 100 });
    const other = createStorage({ storage: backend, prefix: 'app' });
    const listener = vi.fn();
    other.subscribe('draft', listener);
    expect(storage.setExpiration('draft', { expiresAt: now + 100 })).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    storage.setExpiration('draft', null);
    storage.setExpiration('draft', null);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith({ key: 'draft', type: 'set', source: 'local' });
    storage.setExpiration('draft', { expiresAt: now - 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(backend.getItem('app:draft')).not.toBeNull();
    expect(storage.getItem('draft')).toBeNull();
    expect(listener).toHaveBeenLastCalledWith({ key: 'draft', type: 'expire', source: 'local' });
  });

  it('preserves deadlines by default and allows explicit replacement or removal', () => {
    storage.setItem('draft', 1, { ttl: 100 });
    vi.setSystemTime(now + 20);
    storage.setItem('draft', 2);
    storage.updateItem<number>('draft', (value) => value! + 1);
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: now + 100 });
    storage.updateItem('draft', () => 4, { expiresAt: null });
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: null });
    storage.setItem('draft', 5);
    expect(storage.getExpiration('draft')?.expiresAt).toBeNull();
    storage.setItem('draft', 6, { ttl: 100 });
    expect(storage.getExpiration('draft')?.expiresAt).toBe(now + 120);
  });

  it('preserves the deadline at the exact boundary, including empty write options', () => {
    storage.setItem('draft', 1, { ttl: 100 });
    vi.setSystemTime(now + 100);
    storage.setItem('draft', 2, {});
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: now + 100 });
    expect(storage.getItem('draft')).toBe(2);
    vi.setSystemTime(now + 101);
    expect(storage.getItem('draft')).toBeNull();
  });

  it('initializes stored null with its deadline and allows explicit removal on writes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.setItem('draft', null, { ttl: 100 });
    expect(storage.getOrInit('draft', () => 'initialized')).toBe('initialized');
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: now + 100 });
    storage.setItem('draft', 'permanent', { expiresAt: null });
    expect(storage.getExpiration('draft')).toEqual({ expiresAt: null });
  });

  it('writes without expiration when preserving missing, unreadable, or expired entries', () => {
    backend.setItem('app:foreign', 'foreign');
    storage.setItem('expired', 1, { ttl: 1 });
    vi.setSystemTime(now + 2);
    for (const key of ['missing', 'foreign', 'expired']) {
      storage.setItem(key, 2);
      expect(storage.getExpiration(key)).toEqual({ expiresAt: null });
    }
  });

  it('preserves legacy envelopes and stored null during metadata updates', () => {
    const core = createCoreStorage({ storage: backend, serializer: JSON });
    backend.setItem(
      'legacy',
      JSON.stringify({ __gs: true, version: 1, value: null, expiry: null, extra: 'keep' }),
    );
    expect(core.setExpiration('legacy', { ttl: 100 })).toBe(true);
    expect(JSON.parse(backend.getItem('legacy')!)).toEqual({
      __gs: true,
      version: 1,
      value: null,
      expiry: now + 100,
      extra: 'keep',
    });
    expect(core.has('legacy')).toBe(true);
  });

  it('rejects invalid expiration options without mutations', () => {
    storage.setItem('draft', 1);
    const original = backend.getItem('app:draft');
    for (const options of [
      {},
      { ttl: Infinity },
      { ttl: NaN },
      { expiresAt: new Date(NaN) },
      { ttl: 1, expiresAt: now },
    ]) {
      expect(() => storage.setExpiration('draft', options as ExpirationOptions)).toThrow(TypeError);
      expect(backend.getItem('app:draft')).toBe(original);
    }
    expect(() => storage.setItem('draft', 2, { ttl: 1, expiresAt: null })).toThrow(TypeError);
    expect(backend.getItem('app:draft')).toBe(original);
  });

  it('propagates backend and serialization failures without successful-write notifications', () => {
    storage.setItem('draft', 1);
    const listener = vi.fn();
    storage.subscribe('draft', listener);
    const write = vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => storage.setExpiration('draft', { ttl: 10 })).toThrow('quota');
    write.mockRestore();
    const core = createCoreStorage({
      storage: backend,
      prefix: 'app',
      serializer: {
        parse,
        stringify: () => {
          throw new Error('serialize');
        },
      },
    });
    expect(() => core.setExpiration('draft', { ttl: 10 })).toThrow('serialize');
    expect(listener).not.toHaveBeenCalled();
    vi.spyOn(backend, 'getItem').mockImplementation(() => {
      throw new Error('access');
    });
    expect(() => storage.getExpiration('draft')).toThrow('access');
    expect(() => storage.setExpiration('draft', null)).toThrow('access');
  });
});
