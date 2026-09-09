import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';
import type { StorageChange, StorageListener } from './core-entry';
import type { UltraStorage, StorageChange as DefaultStorageChange } from './index';

describe('subscriptions', () => {
  let backend: Storage;
  let storage: UltraStorage;
  let cleanups: (() => void)[];

  beforeEach(() => {
    backend = createMemoryStorage();
    storage = createStorage({ storage: backend });
    cleanups = [];
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function watch(key: string, listener = vi.fn<StorageListener>(), instance = storage) {
    const stop = instance.subscribe(key, listener);
    cleanups.push(stop);
    return { listener, stop };
  }

  it('exports types from both entry points and delivers synchronous immutable events', () => {
    expectTypeOf<StorageChange>().toEqualTypeOf<DefaultStorageChange>();
    const { listener } = watch('theme');
    expect(listener).not.toHaveBeenCalled();
    storage.setItem('theme', 'dark');
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      key: 'theme',
      type: 'set',
      source: 'local',
    });
    expect(Object.isFrozen(listener.mock.calls[0]![0])).toBe(true);
    expect(storage.getItem('theme')).toBe('dark');
  });

  it('allows listeners to read the committed value', () => {
    const values: unknown[] = [];
    watch(
      'theme',
      vi.fn<StorageListener>(() => values.push(storage.getItem('theme'))),
    );
    storage.setItem('theme', 'dark');
    storage.removeItem('theme');
    expect(values).toEqual(['dark', null]);
  });

  it('shares notifications with instances that never subscribe', () => {
    const writer = createStorage({ storage: backend });
    const { listener } = watch('theme');
    writer.setItem('theme', 'dark');
    writer.removeItem('theme');
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['set', 'remove']);
  });

  it('shares the registry with the core entry point without parsing event values', () => {
    const parse = vi.fn(JSON.parse);
    const core = createCoreStorage({
      storage: backend,
      serializer: { stringify: JSON.stringify, parse },
    });
    const { listener: defaultListener } = watch('theme');
    const { listener: coreListener } = watch('theme', vi.fn(), core);
    core.setItem('theme', 'dark');
    storage.setItem('theme', 'light');
    expect(defaultListener).toHaveBeenCalledTimes(2);
    expect(coreListener).toHaveBeenCalledTimes(2);
    expect(parse).not.toHaveBeenCalled();
  });

  it('matches backend identity and the fully prefixed key', () => {
    const namespaced = createStorage({ storage: backend, prefix: 'app', separator: '/' });
    const other = createStorage({ storage: backend, prefix: 'other', separator: '/' });
    const otherBackend = createStorage({ storage: createMemoryStorage() });
    const { listener } = watch('theme', vi.fn(), namespaced);
    const { listener: rawListener } = watch('app/theme');
    const { listener: otherListener } = watch('theme', vi.fn(), other);
    const { listener: otherBackendListener } = watch('app/theme', vi.fn(), otherBackend);
    storage.setItem('app/theme', 'dark');
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      key: 'theme',
      type: 'set',
      source: 'local',
    });
    expect(rawListener).toHaveBeenCalledExactlyOnceWith({
      key: 'app/theme',
      type: 'set',
      source: 'local',
    });
    expect(otherListener).not.toHaveBeenCalled();
    expect(otherBackendListener).not.toHaveBeenCalled();
  });

  it('supports empty keys and separators', () => {
    const namespaced = createStorage({ storage: backend, prefix: 'app', separator: '' });
    const { listener } = watch('', vi.fn(), namespaced);
    storage.setItem('app', 'value');
    expect(listener).toHaveBeenCalledExactlyOnceWith({ key: '', type: 'set', source: 'local' });
  });

  it('keeps repeated subscriptions independent and unsubscription idempotent', () => {
    const listener = vi.fn();
    const first = watch('theme', listener);
    const second = watch('theme', listener);
    storage.setItem('theme', 1);
    expect(listener).toHaveBeenCalledTimes(2);
    first.stop();
    first.stop();
    storage.setItem('theme', 2);
    expect(listener).toHaveBeenCalledTimes(3);
    second.stop();
    storage.setItem('theme', 3);
    expect(listener).toHaveBeenCalledTimes(3);
    watch('theme', listener);
    storage.setItem('theme', 4);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('preserves destructured method calls', () => {
    // Intentionally verify the factory's binding-free public API.
    // oxlint-disable-next-line typescript/unbound-method
    const { subscribe, setItem } = storage;
    const listener = vi.fn();
    cleanups.push(subscribe('theme', listener));
    setItem('theme', 'dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('skips identical serialized writes and missing-key removals', () => {
    const { listener } = watch('value');
    storage.removeItem('value');
    storage.setItem('value', { nested: new Set([1, 2]) });
    storage.setItem('value', { nested: new Set([1, 2]) });
    storage.removeItem('value');
    storage.removeItem('value');
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['set', 'remove']);
  });

  it('counts expiry metadata changes as writes', () => {
    vi.useFakeTimers({ now: 1000 });
    const { listener } = watch('value');
    storage.setItem('value', 'same', { ttl: 1000 });
    storage.setItem('value', 'same', { expiresAt: 2000 });
    storage.setItem('value', 'same', { expiresAt: 3000 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not add notification reads to unobserved writes', () => {
    const get = vi.spyOn(backend, 'getItem');
    storage.setItem('value', 1);
    storage.removeItem('value');
    watch('unrelated');
    storage.setItem('value', 2);
    storage.removeItem('value');
    expect(get).not.toHaveBeenCalled();
  });

  it('does not notify on serializer, option, or backend failures', () => {
    const { listener } = watch('value');
    expect(() => storage.setItem('value', () => {})).toThrow();
    expect(() => storage.setItem('value', 1, { ttl: 100, expiresAt: 100 })).toThrow();
    vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => storage.setItem('value', 1)).toThrow('quota');
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify on failed removals or failed expiry cleanup', () => {
    vi.useFakeTimers({ now: 1000 });
    storage.setItem('value', 1, { ttl: 100 });
    const { listener } = watch('value');
    vi.spyOn(backend, 'removeItem').mockImplementation(() => {
      throw new Error('remove failed');
    });
    expect(() => storage.removeItem('value')).toThrow('remove failed');
    vi.advanceTimersByTime(101);
    expect(() => storage.getItem('value')).toThrow('remove failed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses the underlying write notifications for helpers', () => {
    const { listener } = watch('count');
    storage.getOrInit('count', () => 1);
    storage.getOrInit('count', () => 2);
    storage.updateItem<number>('count', (value) => value! + 1);
    storage.updateItem<number>('count', (value) => value!);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['set', 'set']);
  });

  it('keeps expiry lazy and bookkeeping reads side-effect free', () => {
    vi.useFakeTimers({ now: 1000 });
    storage.setItem('value', 'old', { ttl: 100 });
    const { listener } = watch('value');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(101);
    expect(storage.has('value')).toBe(false);
    expect(storage.key(0)).toBeNull();
    expect(storage.length).toBe(0);
    expect(backend.getItem('value')).not.toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(storage.getItem('value')).toBeNull();
    expect(listener).toHaveBeenCalledExactlyOnceWith({
      key: 'value',
      type: 'expire',
      source: 'local',
    });
    expect(backend.getItem('value')).toBeNull();
    storage.getItem('value');
    storage.clearExpired();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies about expiry cleanup and the subsequent initialization', () => {
    vi.useFakeTimers({ now: 1000 });
    storage.setItem('value', 'old', { ttl: 100 });
    const { listener } = watch('value');
    vi.advanceTimersByTime(101);
    storage.getOrInit('value', () => 'new');
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['expire', 'set']);
  });

  it('completes a scoped clear before delivering removal events', () => {
    const namespaced = createStorage({ storage: backend, prefix: 'app' });
    namespaced.setItem('a', 1);
    namespaced.setItem('b', 2);
    storage.setItem('outside', 3);
    backend.setItem('app:foreign', 'raw');
    const lengths: number[] = [];
    const first = watch(
      'a',
      vi.fn<StorageListener>(() => lengths.push(namespaced.length)),
      namespaced,
    );
    const second = watch(
      'b',
      vi.fn<StorageListener>(() => lengths.push(namespaced.length)),
      namespaced,
    );
    const outside = watch('outside');
    const foreign = watch('foreign', vi.fn(), namespaced);
    namespaced.clear();
    expect(lengths).toEqual([0, 0]);
    expect(first.listener.mock.calls[0]![0].type).toBe('remove');
    expect(second.listener.mock.calls[0]![0].type).toBe('remove');
    expect(outside.listener).not.toHaveBeenCalled();
    expect(foreign.listener).not.toHaveBeenCalled();
    expect(backend.getItem('app:foreign')).toBe('raw');
  });

  it('clearExpired only notifies for expired subscribed keys', () => {
    vi.useFakeTimers({ now: 1000 });
    storage.setItem('expired', 1, { ttl: 100 });
    storage.setItem('valid', 2, { ttl: 1000 });
    const expired = watch('expired');
    const valid = watch('valid');
    vi.advanceTimersByTime(101);
    storage.clearExpired();
    expect(expired.listener).toHaveBeenCalledExactlyOnceWith({
      key: 'expired',
      type: 'expire',
      source: 'local',
    });
    expect(valid.listener).not.toHaveBeenCalled();
  });

  it.each(['clear', 'clearExpired'] as const)(
    'reports completed removals when %s fails partway',
    (method) => {
      vi.useFakeTimers({ now: 1000 });
      storage.setItem('a', 1, { ttl: 100 });
      storage.setItem('b', 2, { ttl: 100 });
      const first = watch('a');
      const second = watch('b');
      const original = backend.removeItem.bind(backend);
      const failure = new Error('second removal failed');
      vi.spyOn(backend, 'removeItem').mockImplementation((key) => {
        if (key === 'b') throw failure;
        original(key);
      });
      vi.advanceTimersByTime(101);
      expect(() => storage[method]()).toThrow(failure);
      expect(first.listener).toHaveBeenCalledExactlyOnceWith({
        key: 'a',
        type: method === 'clear' ? 'remove' : 'expire',
        source: 'local',
      });
      expect(second.listener).not.toHaveBeenCalled();
      expect(backend.getItem('a')).toBeNull();
      expect(backend.getItem('b')).not.toBeNull();
    },
  );

  it('queues reentrant writes in FIFO order across keys', () => {
    const order: string[] = [];
    watch(
      'a',
      vi.fn(() => {
        order.push('a:first');
        storage.setItem('b', 2);
        order.push('a:first:done');
      }),
    );
    watch(
      'a',
      vi.fn<StorageListener>(() => order.push('a:second')),
    );
    watch(
      'b',
      vi.fn<StorageListener>(() => order.push('b')),
    );
    storage.setItem('a', 1);
    expect(order).toEqual(['a:first', 'a:first:done', 'a:second', 'b']);
  });

  it('does not deliver queued events to unsubscribed or newly added listeners', () => {
    const added = vi.fn();
    watch(
      'value',
      vi.fn(() => {
        second.stop();
        watch('value', added);
      }),
    );
    const second = watch('value');
    storage.setItem('value', 1);
    expect(second.listener).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    storage.setItem('value', 2);
    expect(added).toHaveBeenCalledTimes(1);
  });

  it.each(['reportError', 'console'] as const)('isolates listener errors using %s', (reporter) => {
    const error = new Error('listener failed');
    const report = vi.fn();
    vi.stubGlobal('reportError', reporter === 'reportError' ? report : undefined);
    if (reporter === 'console') vi.spyOn(console, 'error').mockImplementation(report);
    watch(
      'value',
      vi.fn(() => {
        throw error;
      }),
    );
    const next = watch('value');
    expect(() => storage.setItem('value', 1)).not.toThrow();
    expect(report).toHaveBeenCalledWith(error);
    expect(next.listener).toHaveBeenCalledTimes(1);
    expect(storage.getItem('value')).toBe(1);
  });

  it('preserves writes and later listeners even when the error reporter throws', () => {
    vi.stubGlobal('reportError', () => {
      throw new Error('reporter failed');
    });
    watch(
      'value',
      vi.fn(() => {
        throw new Error('listener failed');
      }),
    );
    const next = watch('value');
    expect(() => storage.setItem('value', 1)).not.toThrow();
    expect(next.listener).toHaveBeenCalledTimes(1);
  });

  it('does not observe direct backend writes on the same page', () => {
    const { listener } = watch('value');
    backend.setItem('value', 'raw');
    backend.removeItem('value');
    backend.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('preserves fresh deserialized object reads', () => {
    watch('value');
    storage.setItem('value', { nested: new Set([1]) });
    const first = storage.getItem<{ nested: Set<number> }>('value')!;
    first.nested.add(2);
    expect(storage.getItem('value')).toEqual({ nested: new Set([1]) });
  });

  describe('browser events', () => {
    let target: EventTarget;

    beforeEach(() => {
      target = new EventTarget();
      vi.stubGlobal('window', target);
    });

    function dispatch(
      key: string | null,
      newValue: string | null,
      oldValue: string | null = null,
      storageArea = backend,
    ) {
      target.dispatchEvent(
        Object.assign(new Event('storage'), { key, newValue, oldValue, storageArea }),
      );
    }

    it('attaches one listener per backend lazily and detaches after the last unsubscribe', () => {
      const add = vi.spyOn(target, 'addEventListener');
      const remove = vi.spyOn(target, 'removeEventListener');
      const writer = createStorage({ storage: backend });
      writer.setItem('a', 1);
      expect(add).not.toHaveBeenCalled();
      const first = watch('a');
      const second = watch('b', vi.fn(), writer);
      expect(add).toHaveBeenCalledTimes(1);
      first.stop();
      expect(remove).not.toHaveBeenCalled();
      second.stop();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove.mock.calls[0]).toEqual(add.mock.calls[0]);
      watch('a');
      expect(add).toHaveBeenCalledTimes(2);
    });

    it('filters exact keys and storage areas and reports writes and deletes', () => {
      const namespaced = createStorage({ storage: backend, prefix: 'app' });
      const { listener } = watch('theme', vi.fn(), namespaced);
      dispatch('app:theme', 'value', null, createMemoryStorage());
      dispatch('other:theme', 'value');
      dispatch('app:theme-extra', 'value');
      dispatch('app:theme', 'same', 'same');
      expect(listener).not.toHaveBeenCalled();
      dispatch('app:theme', 'value');
      dispatch('app:theme', null, 'value');
      expect(listener.mock.calls.map(([event]) => event)).toEqual([
        { key: 'theme', type: 'set', source: 'external' },
        { key: 'theme', type: 'remove', source: 'external' },
      ]);
    });

    it('invalidates every subscribed key in a natively cleared backend', () => {
      const first = watch('a');
      const namespaced = createStorage({ storage: backend, prefix: 'app' });
      const second = watch('b', vi.fn(), namespaced);
      const other = watch('a', vi.fn(), createStorage({ storage: createMemoryStorage() }));
      dispatch(null, null);
      expect(first.listener).toHaveBeenCalledExactlyOnceWith({
        key: 'a',
        type: 'remove',
        source: 'external',
      });
      expect(second.listener).toHaveBeenCalledExactlyOnceWith({
        key: 'b',
        type: 'remove',
        source: 'external',
      });
      expect(other.listener).not.toHaveBeenCalled();
    });

    it('notifies for foreign or invalid values without writing received events back', () => {
      const values: unknown[] = [];
      const { listener } = watch(
        'value',
        vi.fn<StorageListener>(() => values.push(storage.getItem('value'))),
      );
      const set = vi.spyOn(backend, 'setItem');
      const remove = vi.spyOn(backend, 'removeItem');
      for (const value of ['raw', '{', '{"other":true}']) {
        backend.setItem('value', value);
        dispatch('value', value);
      }
      expect(listener).toHaveBeenCalledTimes(3);
      expect(values).toEqual([null, null, null]);
      expect(set).toHaveBeenCalledTimes(3);
      expect(remove).not.toHaveBeenCalled();
    });

    it('handles empty keys and empty string values', () => {
      const { listener } = watch('');
      dispatch('', '');
      expect(listener).toHaveBeenCalledExactlyOnceWith({
        key: '',
        type: 'set',
        source: 'external',
      });
    });
  });
});
