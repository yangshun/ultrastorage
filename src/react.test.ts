// @vitest-environment jsdom
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import {
  createElement,
  StrictMode,
  useLayoutEffect,
  useState,
  startTransition,
  Suspense,
} from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryStorage, createStorage } from './index';
import { createStorage as createCoreStorage } from './core-entry';
import type { GreatStorage } from './types';
import { createStorageHook, useStorage } from './react';

const numberSchema: StandardSchemaV1<unknown, number> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      typeof value === 'number' ? { value } : { issues: [{ message: 'Expected number' }] },
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('React storage hooks', () => {
  it('binds hooks, shares updates across consumers, and keeps defaults display-only', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    const usePreferences = createStorageHook(storage);
    const first = renderHook(() => usePreferences('theme', { defaultValue: 'light' }));
    const second = renderHook(() => useStorage<string>(storage, 'theme'));
    expect(first.result.current[0]).toBe('light');
    expect(second.result.current[0]).toBeNull();
    expect(backend.length).toBe(0);
    act(() => first.result.current[1]('dark'));
    expect(second.result.current[0]).toBe('dark');
    act(() => second.result.current[2]());
    expect(first.result.current[0]).toBe('light');
    expect(second.result.current[0]).toBeNull();
  });

  it('reads latest state for consecutive functional updates and supports expiration options', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1000 });
    const storage = createStorage({ storage: createMemoryStorage() });
    const { result, rerender } = renderHook(() =>
      useStorage(storage, 'count', { defaultValue: 2 }),
    );
    act(() => {
      storage.setItem('count', 4);
      result.current[1]((n) => n + 1);
      result.current[1]((n) => n + 1, { ttl: 100 });
    });
    expect(result.current[0]).toBe(6);
    vi.setSystemTime(1101);
    rerender();
    expect(result.current[0]).toBe(2);
    act(() => result.current[1]((n) => n + 1));
    vi.setSystemTime(5000);
    expect(storage.getItem('count')).toBe(3);
    act(() => result.current[1](8, { expiresAt: new Date(6000) }));
    vi.setSystemTime(6001);
    act(() => storage.clearExpired());
    expect(result.current[0]).toBe(2);
  });

  it('preserves rich object identity until bytes change and does not share core read objects', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    const value = { map: new Map([['x', 1]]), set: new Set([2]), date: new Date(0) };
    storage.setItem('rich', value);
    const { result, rerender } = renderHook(() => useStorage<typeof value>(storage, 'rich'));
    const snapshot = result.current[0];
    const setter = result.current[1];
    const remove = result.current[2];
    rerender();
    expect(result.current[0]).toBe(snapshot);
    expect(result.current[1]).toBe(setter);
    expect(result.current[2]).toBe(remove);
    expect(storage.getItem('rich')).not.toBe(snapshot);
    act(() => storage.setItem('rich', value));
    expect(result.current[0]).toBe(snapshot);
    act(() => setter((previous) => ({ ...previous!, map: new Map([['x', 3]]) })));
    expect(result.current[0]).not.toBe(snapshot);
    expect(snapshot?.map.get('x')).toBe(1);
    expect(result.current[0]?.map.get('x')).toBe(3);
  });

  it('handles null and undefined without replacing valid undefined with a default', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('value', undefined);
    const hook = renderHook(() =>
      useStorage<string | undefined>(storage, 'value', { defaultValue: 'fallback' }),
    );
    expect(hook.result.current[0]).toBeUndefined();
    act(() => storage.setItem('value', null));
    expect(hook.result.current[0]).toBe('fallback');
    const explicit = renderHook(() => useStorage(storage, 'absent', { defaultValue: undefined }));
    expect(explicit.result.current[0]).toBeNull();
    const nullable = renderHook(() => useStorage<number>(storage, 'absent'));
    act(() => nullable.result.current[1]((previous) => (previous === null ? 5 : 10)));
    expect(nullable.result.current[0]).toBe(5);
  });

  it('validates, transforms, and refreshes schema results with stable or inline options', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('n', 2);
    const validate = vi.fn((value: unknown) =>
      typeof value === 'number'
        ? { value: { doubled: value * 2 } }
        : { issues: [{ message: 'Invalid' }] },
    );
    const schema: StandardSchemaV1<unknown, { doubled: number }> = {
      '~standard': { version: 1, vendor: 'test', validate },
    };
    const hook = renderHook(
      ({ multiplier }) =>
        useStorage(storage, 'n', {
          schema:
            multiplier === 2
              ? schema
              : {
                  '~standard': {
                    version: 1,
                    vendor: 'test',
                    validate: (value: unknown) => ({
                      value: { doubled: Number(value) * multiplier },
                    }),
                  },
                },
          defaultValue: { doubled: 0 },
        }),
      { initialProps: { multiplier: 2 } },
    );
    const value = hook.result.current[0];
    hook.rerender({ multiplier: 2 });
    expect(hook.result.current[0]).toBe(value);
    expect(validate).toHaveBeenCalledTimes(1);
    hook.rerender({ multiplier: 3 });
    expect(hook.result.current[0]).toEqual({ doubled: 6 });
    const numeric = renderHook(() =>
      useStorage(storage, 'n', { schema: numberSchema, defaultValue: 10 }),
    );
    act(() => storage.setItem('n', 'bad'));
    expect(numeric.result.current[0]).toBe(10);
    act(() => numeric.result.current[1]((n) => n + 1));
    expect(storage.getItem('n')).toBe(11);
  });

  it('uses new committed defaults and schemas without replacing callbacks', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    const hook = renderHook(
      ({ defaultValue, schema }) => useStorage(storage, 'n', { defaultValue, schema }),
      {
        initialProps: { defaultValue: 1, schema: numberSchema },
      },
    );
    const setter = hook.result.current[1];
    hook.rerender({ defaultValue: 20, schema: numberSchema });
    expect(hook.result.current[1]).toBe(setter);
    act(() => setter((n) => n + 1));
    expect(hook.result.current[0]).toBe(21);
    const schema: StandardSchemaV1<unknown, number> = {
      '~standard': { version: 1, vendor: 'test', validate: () => ({ value: 100 }) },
    };
    hook.rerender({ defaultValue: 30, schema });
    act(() => setter((n) => n + 1));
    expect(storage.getItem('n')).toBe(101);
  });

  it('switches keys and instances, isolating backends and prefixes', () => {
    const backend = createMemoryStorage();
    const a = createStorage({ storage: backend, prefix: 'a', separator: '/' });
    const peer = createCoreStorage({
      storage: backend,
      prefix: 'a',
      separator: '/',
      serializer: JSON,
    });
    const b = createStorage({ storage: backend, prefix: 'b' });
    const isolated = createStorage({ storage: createMemoryStorage(), prefix: 'a', separator: '/' });
    const hook = renderHook(({ storage, key }) => useStorage<number>(storage, key), {
      initialProps: { storage: a, key: 'x' },
    });
    act(() => {
      b.setItem('x', 8);
      isolated.setItem('x', 9);
      peer.setItem('x', 1);
    });
    expect(hook.result.current[0]).toBe(1);
    hook.rerender({ storage: a, key: 'y' });
    act(() => peer.setItem('x', 3));
    expect(hook.result.current[0]).toBeNull();
    act(() => hook.result.current[1](4));
    expect(a.getItem('y')).toBe(4);
    hook.rerender({ storage: b, key: 'x' });
    expect(hook.result.current[0]).toBe(8);
    act(() => hook.result.current[2]());
    expect(b.getItem('x')).toBeNull();
    expect(a.getItem('x')).toBe(3);
  });

  it('leaves expired entries untouched in rendering and detects unobserved backend writes', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 0 });
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('n', { n: 1 }, { ttl: 10 });
    const remove = vi.spyOn(backend, 'removeItem');
    const hook = renderHook(() => useStorage(storage, 'n'));
    vi.setSystemTime(11);
    hook.rerender();
    expect(hook.result.current[0]).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(backend.length).toBe(1);
    backend.setItem('n', JSON.stringify({ __gs: true, version: 1, value: 7, expiry: null }));
    hook.rerender();
    expect(hook.result.current[0]).toBe(7);
    hook.unmount();
    storage.setItem('n', 8);
    const remount = renderHook(() => useStorage(storage, 'n'));
    expect(remount.result.current[0]).toBe(8);
  });

  it('receives matching browser events including invalid data, deletions, and native clear', () => {
    const storage = createStorage({ prefix: 'react' });
    const hook = renderHook(() => useStorage<number>(storage, 'n'));
    const external = (key: string | null, newValue: string | null, storageArea = localStorage) => {
      if (key === null) storageArea.clear();
      else if (newValue === null) storageArea.removeItem(key);
      else storageArea.setItem(key, newValue);
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue, oldValue: 'old', storageArea }),
      );
    };
    const raw = JSON.stringify({ __gs: true, version: 1, value: 4, expiry: null });
    act(() => external('react:n', raw));
    expect(hook.result.current[0]).toBe(4);
    act(() => {
      external('other', raw);
      external('react:n', raw, sessionStorage);
    });
    expect(hook.result.current[0]).toBe(4);
    act(() => external('react:n', 'foreign'));
    expect(hook.result.current[0]).toBeNull();
    act(() => external('react:n', raw));
    act(() => external('react:n', null));
    expect(hook.result.current[0]).toBeNull();
    act(() => external('react:n', raw));
    act(() => external(null, null));
    expect(hook.result.current[0]).toBeNull();
  });

  it('cleans up subscriptions under Strict Mode', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    let active = 0;
    const original = storage.subscribe.bind(storage);
    vi.spyOn(storage, 'subscribe').mockImplementation((key, callback) => {
      active++;
      const unsubscribe = original(key, callback);
      return () => {
        active--;
        unsubscribe();
      };
    });
    const hook = renderHook(() => useStorage(storage, 'n'), { wrapper: StrictMode });
    expect(active).toBe(1);
    act(() => storage.setItem('n', 1));
    expect(hook.result.current[0]).toBe(1);
    hook.unmount();
    expect(active).toBe(0);
  });

  it('catches a mutation between render and subscription', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    function View() {
      const [value] = useStorage(storage, 'n');
      useLayoutEffect(() => storage.setItem('n', 9), []);
      return createElement('span', null, String(value));
    }
    expect(render(createElement(View)).container.textContent).toBe('9');
  });

  it('does not leak options from a suspended render into a committed setter', async () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    let setter!: (next: (n: number) => number) => void;
    let change!: (n: number) => void;
    const pending = new Promise(() => {});
    function View() {
      const [fallback, setFallback] = useState(1);
      change = setFallback;
      const [value, setValue] = useStorage(storage, 'n', { defaultValue: fallback });
      if (fallback === 99) throw pending;
      setter = setValue;
      return createElement('span', null, value);
    }
    const view = render(createElement(Suspense, { fallback: 'loading' }, createElement(View)));
    await act(async () => {
      startTransition(() => change(99));
    });
    expect(view.container.textContent).toBe('1');
    act(() => setter((n) => n + 1));
    expect(storage.getItem('n')).toBe(2);
  });

  it('propagates mutation errors without optimistic changes', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('n', 1);
    const hook = renderHook(() => useStorage<number>(storage, 'n'));
    vi.spyOn(backend, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => hook.result.current[1](2)).toThrow('quota');
    expect(() =>
      hook.result.current[1](() => {
        throw new Error('updater');
      }),
    ).toThrow('updater');
    expect(() => hook.result.current[1](2, { ttl: 1, expiresAt: 2 })).toThrow(
      'Cannot specify both',
    );
    vi.spyOn(backend, 'removeItem').mockImplementation(() => {
      throw new Error('remove');
    });
    expect(hook.result.current[2]).toThrow('remove');
    expect(hook.result.current[0]).toBe(1);
  });

  it('rejects unsupported instances, async schemas, and read/validation errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useStorage({} as GreatStorage, 'n'))).toThrow(
      'created by greatstorage',
    );
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('n', 1);
    const schema: StandardSchemaV1<unknown, number> = {
      '~standard': { version: 1, vendor: 'test', validate: async () => ({ value: 1 }) },
    };
    expect(() => renderHook(() => useStorage(storage, 'n', { schema }))).toThrow('synchronous');
    vi.spyOn(schema['~standard'], 'validate').mockImplementation(() => {
      throw new Error('validation');
    });
    expect(() => renderHook(() => useStorage(storage, 'n', { schema }))).toThrow('validation');
    vi.spyOn(backend, 'getItem').mockImplementation(() => {
      throw new Error('read');
    });
    expect(() => renderHook(() => useStorage(storage, 'n'))).toThrow('read');
  });

  it('hydrates the server fallback before showing browser data without a mismatch', async () => {
    const storage = createStorage();
    storage.setItem('n', 42);
    const reads = vi.spyOn(Storage.prototype, 'getItem');
    const renders: number[] = [];
    function View() {
      const [value] = useStorage(storage, 'n', { defaultValue: 0 });
      renders.push(value);
      return createElement('span', null, value);
    }
    const html = renderToString(createElement(View));
    expect(html).toBe('<span>0</span>');
    expect(reads).not.toHaveBeenCalled();
    const container = document.createElement('div');
    container.innerHTML = html;
    const recover = vi.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, createElement(View), { onRecoverableError: recover });
    });
    expect(renders.slice(0, 2)).toEqual([0, 0]);
    expect(container.textContent).toBe('42');
    expect(recover).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('infers default, schema, explicit, and bound hook types', () => {
    const storage = createStorage({ storage: createMemoryStorage() });
    const bound = createStorageHook(storage);
    renderHook(() => {
      const nullableSchema: StandardSchemaV1<unknown, number | null> = {
        '~standard': { version: 1, vendor: 'test', validate: () => ({ value: null }) },
      };
      expectTypeOf(
        useStorage(storage, 'n', { schema: nullableSchema, defaultValue: 0 })[0],
      ).toEqualTypeOf<number>();
      expectTypeOf(
        bound('n', { schema: nullableSchema, defaultValue: 0 })[0],
      ).toEqualTypeOf<number>();
      expectTypeOf(
        useStorage<number | null>(storage, 'n', { defaultValue: 0 })[0],
      ).toEqualTypeOf<number>();
      expectTypeOf(useStorage<number>(storage, 'n', { defaultValue: undefined })[0]).toEqualTypeOf<
        number | null
      >();
      expectTypeOf(
        useStorage(storage, 'n', { schema: numberSchema, defaultValue: null })[0],
      ).toEqualTypeOf<number | null>();
      expectTypeOf(useStorage(storage, 'n', { defaultValue: 0 })[0]).toEqualTypeOf<number>();
      expectTypeOf(useStorage<number>(storage, 'n')[0]).toEqualTypeOf<number | null>();
      expectTypeOf(useStorage(storage, 'n', { schema: numberSchema })[0]).toEqualTypeOf<
        number | null
      >();
      expectTypeOf(
        useStorage(storage, 'n', { schema: numberSchema, defaultValue: 0 })[0],
      ).toEqualTypeOf<number>();
      expectTypeOf(bound('n', { defaultValue: 'light' })[0]).toEqualTypeOf<string>();
      expectTypeOf(
        bound('n', { schema: numberSchema, defaultValue: 0 })[0],
      ).toEqualTypeOf<number>();
      expectTypeOf(bound<number>('n')[0]).toEqualTypeOf<number | null>();
    });
    // Checked by TypeScript, never executed: writes must match the inferred value.
    function useTypeErrors() {
      const [, setNumber] = useStorage(storage, 'n', { schema: numberSchema });
      // @ts-expect-error Schema output requires a number.
      setNumber('wrong');
      // @ts-expect-error Functional updates must return a number.
      setNumber(() => 'wrong');
      // @ts-expect-error Fallback must match the schema output.
      useStorage(storage, 'n', { schema: numberSchema, defaultValue: 'wrong' });
      const [, setDefault] = bound('n', { defaultValue: 0 });
      // @ts-expect-error A numeric default infers a numeric setter.
      setDefault('wrong');
    }
    expectTypeOf(useTypeErrors).toBeFunction();
  });

  it('reacts to helper writes, bulk removal, and public lazy cleanup', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1000 });
    const storage = createStorage({ storage: createMemoryStorage() });
    const hook = renderHook(() => useStorage<number>(storage, 'n'));
    act(() => {
      storage.getOrInit('n', () => 1);
    });
    expect(hook.result.current[0]).toBe(1);
    act(() => {
      storage.updateItem<number>('n', (n) => n! + 1);
    });
    expect(hook.result.current[0]).toBe(2);
    act(() => storage.clear());
    expect(hook.result.current[0]).toBeNull();
    act(() => storage.setItem('n', 3, { ttl: 10 }));
    vi.setSystemTime(1011);
    expect(hook.result.current[0]).toBe(3);
    act(() => {
      storage.getItem('n');
    });
    expect(hook.result.current[0]).toBeNull();
  });

  it('recognizes expiration metadata changes and refreshes after raw deletion', () => {
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend });
    storage.setItem('n', { n: 1 });
    const hook = renderHook(() => useStorage(storage, 'n'));
    const original = hook.result.current[0];
    act(() => storage.setItem('n', { n: 1 }, { ttl: 1000 }));
    expect(hook.result.current[0]).toEqual(original);
    expect(hook.result.current[0]).not.toBe(original);
    backend.removeItem('n');
    hook.rerender();
    expect(hook.result.current[0]).toBeNull();
  });

  it('propagates browser backend access failures instead of substituting memory', () => {
    const storage = createStorage();
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useStorage(storage, 'n'))).toThrow('denied');
  });
});
