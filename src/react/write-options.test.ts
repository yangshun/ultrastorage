// @vitest-environment jsdom
import { afterEach, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, startTransition, Suspense, useState } from 'react';
import { renderToString } from 'react-dom/server';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryStorage, createStorage } from '../index';
import { createStorageHook, useStorage } from './index';

const schema: StandardSchemaV1<unknown, string> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] },
  },
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('uses committed per-key defaults without changing callbacks or refreshing expiration on reads', () => {
  vi.useFakeTimers({ now: 1000 });
  const storage = createStorage({ storage: createMemoryStorage() });
  const useBound = createStorageHook(storage);
  const hook = renderHook(
    ({ ttl }) => useBound('filter', { schema, defaultValue: '', writeOptions: { ttl } }),
    { initialProps: { ttl: 100 } },
  );
  expectTypeOf(hook.result.current[0]).toEqualTypeOf<string>();
  const setter = hook.result.current[1];
  act(() => setter('one'));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 1100 });
  vi.setSystemTime(1020);
  hook.rerender({ ttl: 200 });
  expect(hook.result.current[1]).toBe(setter);
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 1100 });
  act(() => setter('two', {}));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 1220 });
});

it('replaces default TTL with setter deadlines, null, or TTL without merging conflicting fields', () => {
  vi.useFakeTimers({ now: 1000 });
  const storage = createStorage({ storage: createMemoryStorage() });
  const hook = renderHook(() =>
    useStorage(storage, 'filter', { defaultValue: '', writeOptions: { ttl: 100 } }),
  );
  act(() => hook.result.current[1]('one', { expiresAt: 1500 }));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 1500 });
  act(() => hook.result.current[1]('two', { expiresAt: null }));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: null });
  act(() => hook.result.current[1]('three', { ttl: 10 }));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 1010 });
  expect(() => hook.result.current[1]('invalid', { ttl: 10, expiresAt: null })).toThrow(
    'Cannot specify both',
  );
});

it('replaces an absolute default with a setter TTL and validates defaults only when written', () => {
  vi.useFakeTimers({ now: 1000 });
  const storage = createStorage({ storage: createMemoryStorage() });
  const hook = renderHook(() =>
    useStorage(storage, 'filter', { defaultValue: '', writeOptions: { expiresAt: 2000 } }),
  );
  act(() => hook.result.current[1]('one'));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 2000 });
  act(() => hook.result.current[1]('two', { ttl: 10 }));
  expect(storage.getExpiration('filter')).toEqual({ expiresAt: 1010 });
  const invalid = renderHook(() => useStorage(storage, 'bad', { writeOptions: { ttl: NaN } }));
  expect(() => invalid.result.current[1]('value')).toThrow('finite expiration');
});

it('does not read or write during SSR with default write options', () => {
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend });
  storage.setItem('filter', 'saved');
  const read = vi.spyOn(backend, 'getItem');
  const write = vi.spyOn(backend, 'setItem');
  function View() {
    const [value] = useStorage(storage, 'filter', {
      defaultValue: 'fallback',
      writeOptions: { ttl: 100 },
    });
    return createElement('span', null, value);
  }
  expect(renderToString(createElement(View))).toBe('<span>fallback</span>');
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it('does not expose write defaults from a suspended render to the committed setter', async () => {
  vi.useFakeTimers({ now: 1000 });
  const storage = createStorage({ storage: createMemoryStorage() });
  let setter!: (value: string) => void;
  let change!: (ttl: number) => void;
  const pending = new Promise(() => {});
  function View() {
    const [ttl, setTtl] = useState(100);
    change = setTtl;
    const [value, setValue] = useStorage(storage, 'draft', {
      defaultValue: '',
      writeOptions: { ttl },
    });
    if (ttl === 999) throw pending;
    setter = setValue;
    return createElement('span', null, value);
  }
  const view = render(createElement(Suspense, { fallback: 'loading' }, createElement(View)));
  await act(async () => {
    startTransition(() => change(999));
  });
  act(() => setter('saved'));
  expect(storage.getExpiration('draft')).toEqual({ expiresAt: 1100 });
  expect(view.container.textContent).toBe('saved');
});
