import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';
import type { SubscribeOptions as CoreSubscribeOptions } from './core-entry';
import type { SubscribeOptions, UltraStorage, StorageKey } from './index';

const cleanups: (() => void)[] = [];
function watch(storage: UltraStorage, key: StorageKey = 'key', listener = vi.fn()) {
  cleanups.push(storage.subscribe(key, listener, { reactiveExpiration: true }));
  return listener;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
});
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reactive expiration', () => {
  it('is opt-in, respects the exact deadline, retains bytes, and allows later cleanup events', () => {
    expectTypeOf<SubscribeOptions>().toEqualTypeOf<CoreSubscribeOptions>();
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('key', 1, { ttl: 10 });
    const raw = backend.getItem('key');
    const ordinary = vi.fn();
    cleanups.push(storage.subscribe('key', ordinary));
    expect(vi.getTimerCount()).toBe(0);
    const reactive = watch(storage);
    vi.advanceTimersByTime(10);
    expect(reactive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reactive).toHaveBeenCalledExactlyOnceWith({
      key: 'key',
      type: 'expire',
      source: 'local',
    });
    expect(Object.isFrozen(reactive.mock.calls[0]![0])).toBe(true);
    expect(ordinary).not.toHaveBeenCalled();
    expect(backend.getItem('key')).toBe(raw);
    expect(storage.getExpiration('key')).toEqual({ expiresAt: 1010 });
    expect(vi.getTimerCount()).toBe(0);
    storage.clearExpired();
    expect(reactive).toHaveBeenCalledTimes(2);
    expect(ordinary).toHaveBeenCalledTimes(1);
  });

  it('notifies already expired entries asynchronously and cleans independent subscriptions', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('key', 1, { ttl: -1 });
    const first = watch(storage);
    const second = watch(storage);
    const stop = cleanups.pop()!;
    expect(first).not.toHaveBeenCalled();
    stop();
    stop();
    vi.advanceTimersByTime(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reschedules shared writers and metadata changes and cancels removed deadlines', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend, prefix: 'app' });
    const writer = createStorage({ storage: backend, prefix: 'app' });
    const listener = watch(storage, ['draft', '1']);
    writer.setItem(['draft', '1'], new Set([1]), { ttl: 10 });
    vi.advanceTimersByTime(5);
    writer.setExpiration(['draft', '1'], { ttl: 20 });
    listener.mockClear();
    vi.advanceTimersByTime(6);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15);
    expect(listener).toHaveBeenCalledTimes(1);
    writer.setItem(['draft', '1'], 2, { ttl: 10 });
    writer.setExpiration(['draft', '1'], null);
    expect(vi.getTimerCount()).toBe(0);
    writer.setExpiration(['draft', '1'], { ttl: 10 });
    writer.removeItem(['draft', '1']);
    expect(vi.getTimerCount()).toBe(0);
    writer.setItem(['draft', '1'], 3, { ttl: 10 });
    writer.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks replacement bytes, unreadable entries, and long or delayed deadlines', () => {
    const backend = createMemoryStorage();
    const storage = createCoreStorage({ storage: backend, serializer: JSON });
    storage.setItem('key', 1, { ttl: 10 });
    const listener = watch(storage);
    // Raw same-page writes do not notify, but a pending timer checks current bytes.
    const replacement = JSON.stringify({ __us: true, version: 1, value: 2, expiry: 1030 });
    backend.setItem('key', replacement);
    vi.advanceTimersByTime(11);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(listener).toHaveBeenCalledTimes(1);
    storage.setItem('key', 3, { ttl: 10 });
    backend.setItem('key', 'unreadable');
    listener.mockClear();
    vi.advanceTimersByTime(11);
    expect(listener).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    storage.setItem('key', 4, { ttl: 2_147_483_657 });
    listener.mockClear();
    vi.advanceTimersByTime(2_147_483_647);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(11);
    expect(listener).toHaveBeenCalledTimes(1);
    storage.setItem('key', 5, { ttl: 10 });
    listener.mockClear();
    vi.setSystemTime(Date.now() + 1000);
    vi.advanceTimersByTime(11);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('uses each subscriber serializer and isolates asynchronous backend and listener failures', () => {
    const backend = createMemoryStorage();
    const serializer = {
      stringify: (value: unknown) => 'custom:' + JSON.stringify(value),
      parse: (raw: string) => JSON.parse(raw.slice(7)),
    };
    const storage = createCoreStorage({ storage: backend, serializer });
    const incompatible = createCoreStorage({ storage: backend, serializer: JSON });
    storage.setItem('key', 1, { ttl: 10 });
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const listener = watch(storage);
    const other = watch(incompatible);
    const get = vi.spyOn(backend, 'getItem').mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    vi.advanceTimersByTime(11);
    expect(report).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    get.mockRestore();
    storage.setItem('key', 2, { ttl: 10 });
    listener.mockClear();
    listener.mockImplementation(() => {
      throw new Error('listener');
    });
    vi.advanceTimersByTime(11);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('supports reentrant renewal and cancellation during timer notifications', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('key', 1, { ttl: 10 });
    let renewed = false;
    const listener = watch(
      storage,
      'key',
      vi.fn((event) => {
        if (event.type === 'expire' && !renewed) {
          renewed = true;
          storage.setItem('key', 2, { ttl: 10 });
        }
      }),
    );
    vi.advanceTimersByTime(22);
    expect(listener.mock.calls.map(([event]) => event.type)).toEqual(['expire', 'set', 'expire']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares resume listeners across backends, rechecks only reactive keys, and detaches them', () => {
    const target = new EventTarget();
    const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', documentTarget);
    const addWindow = vi.spyOn(target, 'addEventListener');
    const removeWindow = vi.spyOn(target, 'removeEventListener');
    const addDocument = vi.spyOn(documentTarget, 'addEventListener');
    const removeDocument = vi.spyOn(documentTarget, 'removeEventListener');
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    const other = createStorage({ storage: createMemoryStorage() });
    storage.setItem('key', 1, { ttl: 10 });
    other.setItem('key', 2, { ttl: 10 });
    const ordinary = vi.fn();
    cleanups.push(storage.subscribe('unobserved', ordinary));
    expect(addWindow.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(0);
    const first = watch(storage);
    const second = watch(other);
    expect(addWindow.mock.calls.filter(([type]) => type === 'focus')).toHaveLength(1);
    expect(addDocument).toHaveBeenCalledTimes(1);
    const read = vi.spyOn(backend, 'getItem');
    // Advance the clock without running timers, as when a suspended tab resumes.
    vi.setSystemTime(2000);
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(read).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    documentTarget.visibilityState = 'visible';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(first).toHaveBeenCalledExactlyOnceWith({ key: 'key', type: 'expire', source: 'local' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(read.mock.calls).toEqual([['key']]);
    expect(backend.getItem('key')).not.toBeNull();
    target.dispatchEvent(new Event('focus'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(ordinary).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    cleanups.pop()!();
    expect(removeDocument).not.toHaveBeenCalled();
    cleanups.pop()!();
    expect(removeDocument.mock.calls[0]).toEqual(addDocument.mock.calls[0]);
    expect(removeWindow.mock.calls.filter(([type]) => type === 'focus')).toEqual(
      addWindow.mock.calls.filter(([type]) => type === 'focus'),
    );
    read.mockClear();
    target.dispatchEvent(new Event('focus'));
    expect(read).not.toHaveBeenCalled();
    watch(storage);
    expect(addDocument).toHaveBeenCalledTimes(2);
  });

  it('focus rechecks current deadlines and isolates failures and queued cancellation', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const backend = createMemoryStorage();
    const storage = createCoreStorage({ storage: backend, serializer: JSON });
    storage.setItem('key', 1, { ttl: 10 });
    const first = watch(storage);
    const second = watch(storage);
    const stopSecond = cleanups[cleanups.length - 1]!;
    first.mockImplementation(() => stopSecond());
    // A replacement written while suspended must be checked before announcing expiry.
    backend.setItem('key', JSON.stringify({ __us: true, version: 1, value: 2, expiry: 3000 }));
    vi.setSystemTime(2000);
    target.dispatchEvent(new Event('focus'));
    expect(first).not.toHaveBeenCalled();
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const read = vi.spyOn(backend, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.setSystemTime(3001);
    target.dispatchEvent(new Event('focus'));
    expect(report).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    read.mockRestore();
    target.dispatchEvent(new Event('focus'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    target.dispatchEvent(new Event('focus'));
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('skips a subscription canceled by an error handler during a resume recheck', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('key', 1, { ttl: 10 });
    const first = watch(storage);
    const second = watch(storage);
    const stopSecond = cleanups[cleanups.length - 1]!;
    const report = vi.fn(() => stopSecond());
    vi.stubGlobal('reportError', report);
    const error = new Error('Storage unavailable');
    const read = vi.spyOn(backend, 'getItem').mockImplementationOnce(() => {
      throw error;
    });

    vi.setSystemTime(2000);
    target.dispatchEvent(new Event('focus'));

    expect(report).toHaveBeenCalledExactlyOnceWith(error);
    // The resume pass captured both subscriptions before the handler canceled the second.
    // It must skip the canceled subscription without reading storage or restarting its timer.
    expect(read).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    target.dispatchEvent(new Event('focus'));
    expect(first).toHaveBeenCalledExactlyOnceWith({ key: 'key', type: 'expire', source: 'local' });
    expect(second).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reschedules from cross-tab changes and cancels on native clears', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const backend = createMemoryStorage();
    const storage = createCoreStorage({ storage: backend, serializer: JSON });
    const listener = watch(storage);
    function dispatch(key: string | null, newValue: string | null) {
      const event = new Event('storage');
      Object.assign(event, { storageArea: backend, key, newValue, oldValue: null });
      target.dispatchEvent(event);
    }
    backend.setItem('key', JSON.stringify({ __us: true, version: 1, value: 1, expiry: 1010 }));
    dispatch('key', backend.getItem('key'));
    expect(listener).toHaveBeenLastCalledWith({ key: 'key', type: 'set', source: 'external' });
    vi.advanceTimersByTime(11);
    expect(listener).toHaveBeenLastCalledWith({ key: 'key', type: 'expire', source: 'local' });
    listener.mockClear();
    dispatch('key', backend.getItem('key'));
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1); // Unchanged expired bytes are not announced twice.
    storage.setItem('key', 2, { ttl: 10 });
    backend.clear();
    dispatch(null, null);
    expect(vi.getTimerCount()).toBe(0);
  });
});
