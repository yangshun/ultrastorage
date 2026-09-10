import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { parse, stringify } from 'devalue';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each([
  ['default', createStorage, { parse, stringify }],
  ['core', createCoreStorage, JSON],
] as const)('%s key enumeration', (_, create, serializer) => {
  it('returns fresh empty snapshots', () => {
    const storage = create({ storage: createMemoryStorage(), serializer });
    const first = storage.keys();
    expect(first).toEqual([]);
    expect(storage.keys()).not.toBe(first);
    expect(storage.key(0)).toBeNull();
  });

  it('preserves backend order and returns reusable string and array keys', () => {
    const storage = create({ storage: createMemoryStorage(), serializer });
    storage.setItem('', 'empty');
    storage.setItem(['users', 'a:b'], 'Alice');
    storage.setItem('last', 'last');
    storage.setItem('', 'updated');

    const keys = storage.keys();
    expect(keys).toEqual(['', ['users', 'a:b'], 'last']);
    expect(keys.map((_, index) => storage.key(index))).toEqual(keys);
    expect(storage.key(keys.length)).toBeNull();
    expect(storage.getItem(keys[1]!)).toBe('Alice');
    storage.removeItem('');
    storage.setItem('', 'reinserted');
    expect(storage.keys()).toEqual([keys[1], 'last', '']);
  });

  it('filters the namespace and foreign data while recognizing legacy envelopes', () => {
    const backend = createMemoryStorage();
    const storage = create({ storage: backend, serializer, prefix: 'app', separator: '/' });
    const legacy = serializer.stringify({ __gs: true, version: 1, value: 'old', expiry: null });
    backend.setItem('other/legacy', legacy);
    backend.setItem('app/legacy', legacy);
    backend.setItem('app/raw', 'foreign');
    backend.setItem('app/unmarked', serializer.stringify({ value: 'foreign' }));
    storage.setItem(['users', '42'], 'Alice');

    const keys = storage.keys();
    expect(keys).toEqual(['legacy', ['users', '42']]);
    expect(keys.map((_, index) => storage.key(index))).toEqual(keys);
    expect(storage.key(keys.length)).toBeNull();
    expect(keys.map((key) => storage.getItem(key))).toEqual(['old', 'Alice']);
    expect(backend.length).toBe(5);
  });

  it('restores existing array keys across instances without rewriting stored entries', () => {
    const backend = createMemoryStorage();
    backend.setItem(
      'app/\u0000us:a:["users","42"]',
      serializer.stringify({ __gs: true, version: 1, value: 'Alice', expiry: null }),
    );
    const write = vi.spyOn(backend, 'setItem');
    const storage = create({ storage: backend, serializer, prefix: 'app', separator: '/' });

    expect(storage.keys()).toEqual([['users', '42']]);
    expect(storage.getItem(storage.keys()[0]!)).toBe('Alice');
    expect(storage.key(0)).toEqual(['users', '42']);
    expect(storage.getItem(storage.key(0)!)).toBe('Alice');
    expect(write).not.toHaveBeenCalled();
  });

  it('returns independent copies of array keys and supports removal through them', () => {
    const storage = create({ storage: createMemoryStorage(), serializer });
    const segments = ['users', 'a:b', '', '"quoted"', '\\', '\u0000', '你好'];
    storage.setItem(segments, 'Alice');
    storage.setItem([], 'empty array');
    storage.setItem('["users","42"]', 'string');
    storage.setItem('\u0000us:a:[ "users" ]', 'noncanonical string');
    const snapshot = storage.keys();

    expect(snapshot).toEqual([segments, [], '["users","42"]', '\u0000us:a:[ "users" ]']);
    expect(snapshot.map((_, index) => storage.key(index))).toEqual(snapshot);
    expect(snapshot[0]).not.toBe(segments);
    expect(storage.keys()[0]).not.toBe(snapshot[0]);
    const indexedKey = storage.key(0);
    expect(indexedKey).not.toBe(segments);
    expect(indexedKey).not.toBe(snapshot[0]);
    expect(storage.key(0)).not.toBe(indexedKey);
    (indexedKey as string[]).push('changed');
    (snapshot[0] as string[]).push('changed');
    expect(storage.key(0)).toEqual(segments);
    expect(storage.keys()[0]).toEqual(segments);
    expect(storage.getItem(segments)).toBe('Alice');

    storage.removeItem(storage.key(0)!);
    expect(storage.has(segments)).toBe(false);
    for (const key of storage.keys()) storage.removeItem(key);
    expect(storage.keys()).toEqual([]);
  });

  it('skips expired array keys without cleanup or notifications when looking up an index', () => {
    vi.useFakeTimers({ now: 1000 });
    const backend = createMemoryStorage();
    const storage = create({ storage: backend, serializer, prefix: 'app' });
    storage.setItem(['expired'], 1, { expiresAt: 1001 });
    storage.setItem(['boundary'], 2, { expiresAt: 1002 });
    storage.setItem(['permanent'], 3);
    vi.setSystemTime(1002);
    const listener = vi.fn();
    const stop = storage.subscribe(['expired'], listener);
    const remove = vi.spyOn(backend, 'removeItem');

    expect(storage.key(0)).toEqual(['boundary']);
    expect(storage.key(1)).toEqual(['permanent']);
    expect(storage.key(2)).toBeNull();
    expect(storage.key(-1)).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(backend.length).toBe(3);
    stop();
  });

  it('checks expiration at call time without cleanup or notifications', () => {
    vi.useFakeTimers({ now: 1000 });
    const backend = createMemoryStorage();
    const storage = create({
      storage: backend,
      serializer: {
        stringify: serializer.stringify,
        parse: (raw) => {
          vi.setSystemTime(2000);
          return serializer.parse(raw);
        },
      },
    });
    storage.setItem('expired', 1, { expiresAt: 1001 });
    storage.setItem('boundary', 2, { expiresAt: 1002 });
    storage.setItem('future', 3, { expiresAt: 1003 });
    storage.setItem('permanent', 4);
    vi.setSystemTime(1002);
    const listener = vi.fn();
    const stop = storage.subscribe('expired', listener);
    const remove = vi.spyOn(backend, 'removeItem');

    expect(storage.keys()).toEqual(['boundary', 'future', 'permanent']);
    expect(storage.keys()).toEqual(['permanent']);
    expect(remove).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(backend.length).toBe(4);
    stop();
  });

  it('continues past unavailable keys and values', () => {
    const backend = createMemoryStorage();
    const storage = create({ storage: backend, serializer });
    storage.setItem('missing-key', 1);
    storage.setItem('missing-value', 2);
    storage.setItem('remaining', 3);
    vi.spyOn(backend, 'key').mockReturnValueOnce(null);
    vi.spyOn(backend, 'getItem').mockReturnValueOnce(null);

    expect(storage.keys()).toEqual(['remaining']);
  });

  it('keeps snapshots independent and allows removal while iterating', () => {
    const backend = createMemoryStorage();
    const storage = create({ storage: backend, serializer });
    storage.setItem('a', 1);
    storage.setItem('b', 2);
    const snapshot = storage.keys();
    storage.setItem('c', 3);
    expect(snapshot).toEqual(['a', 'b']);
    snapshot.push('not-stored');
    expect(storage.keys()).toEqual(['a', 'b', 'c']);

    for (const key of storage.keys()) storage.removeItem(key);
    expect(backend.length).toBe(0);
    expect(snapshot).toEqual(['a', 'b', 'not-stored']);

    backend.setItem(
      'external',
      serializer.stringify({ __us: true, version: 1, value: 4, expiry: null }),
    );
    expect(storage.keys()).toEqual(['external']);
  });

  it('decodes each of 1000 entries only once per enumeration', () => {
    const parseEntry = vi.fn((raw: string) => serializer.parse(raw));
    const storage = create({
      storage: createMemoryStorage(),
      serializer: { stringify: serializer.stringify, parse: parseEntry },
    });
    const expected = Array.from({ length: 1000 }, (_, index) => String(index));
    for (const key of expected) storage.setItem(key, key);

    expect(storage.keys()).toEqual(expected);
    expect(parseEntry).toHaveBeenCalledTimes(expected.length);
  });
});
