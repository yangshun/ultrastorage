// @vitest-environment jsdom
import { afterEach, expect, expectTypeOf, it, vi } from 'vite-plus/test';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { createElement, StrictMode, Suspense, startTransition, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryStorage, createStorage } from '../index';
import { createStorageHook, useStorage } from './index';
import type { StorageDiagnostics, UseStorageResult } from './index';

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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('adds a fourth tuple item only when requested, including bound hooks, with unchanged setter types', () => {
  const storage = createStorage({ storage: createMemoryStorage() });
  const useBound = createStorageHook(storage);
  const hook = renderHook(() => useBound('draft', { schema, defaultValue: '', diagnostics: true }));
  expectTypeOf(hook.result.current).toEqualTypeOf<UseStorageResult<string, string, true>>();
  expect(hook.result.current).toHaveLength(4);
  expect(hook.result.current[3]).toEqual({
    readResult: { __result: true, status: 'missing' },
    lastError: null,
  });
  act(() => {
    expect(hook.result.current[1]('saved')).toBeUndefined();
  });
  expect(hook.result.current[0]).toBe('saved');
  const ordinary = renderHook(() => useStorage(storage, 'draft', { schema, defaultValue: '' }));
  expectTypeOf(ordinary.result.current).toEqualTypeOf<UseStorageResult<string, string>>();
  expect(ordinary.result.current).toHaveLength(3);
});

it('reports stored nullish values, parse failures, invalid envelopes and validation issues distinctly', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend });
  const hook = renderHook(() =>
    useStorage<string>(storage, 'draft', { defaultValue: 'fallback', diagnostics: true }),
  );
  expect(hook.result.current[3].readResult.status).toBe('missing');
  act(() => storage.setItem('draft', null));
  expect(hook.result.current[0]).toBe('fallback');
  expect(hook.result.current[3].readResult).toEqual({
    __result: true,
    status: 'success',
    value: null,
  });
  act(() => storage.setItem('draft', undefined));
  expect(hook.result.current[0]).toBeUndefined();
  expect(hook.result.current[3].readResult).toEqual({
    __result: true,
    status: 'success',
    value: undefined,
  });
  backend.setItem('draft', 'broken data');
  hook.rerender();
  expect(hook.result.current[3].readResult.status).toBe('parse-error');
  const json = createStorage({ storage: backend, serializer: JSON });
  backend.setItem('draft', '{}');
  const unsupported = renderHook(() => useStorage(json, 'draft', { diagnostics: true }));
  expect(unsupported.result.current[3].readResult.status).toBe('unsupported');
  act(() => storage.setItem('draft', 1));
  const invalid = renderHook(() => useStorage(storage, 'draft', { schema, diagnostics: true }));
  expect(invalid.result.current[3].readResult).toEqual({
    __result: true,
    status: 'validation-error',
    issues: [{ message: 'Expected string' }],
  });
});

it('records write and remove errors and rethrows the same error without optimistic changes', () => {
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend });
  storage.setItem('draft', 'saved');
  const hook = renderHook(
    ({ key }) => useStorage(storage, key, { defaultValue: '', diagnostics: true }),
    { initialProps: { key: 'draft' } },
  );
  const error = new Error('quota');
  const write = vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
    throw error;
  });
  act(() => expect(() => hook.result.current[1]('unsaved')).toThrow(error));
  expect(hook.result.current[0]).toBe('saved');
  expect(hook.result.current[3].lastError).toEqual({ operation: 'write', error });
  hook.rerender({ key: 'other' });
  expect(hook.result.current[3].lastError).toBeNull();
  hook.rerender({ key: 'draft' });
  write.mockRestore();
  act(() => hook.result.current[1]('updated'));
  expect(hook.result.current[3].lastError).toBeNull();
  vi.spyOn(backend, 'removeItem').mockImplementationOnce(() => {
    throw error;
  });
  act(() => expect(hook.result.current[2]).toThrow(error));
  expect(hook.result.current[3].lastError).toEqual({ operation: 'remove', error });
  expect(hook.result.current[0]).toBe('updated');
  act(() => hook.result.current[2]());
  expect(hook.result.current[3]).toEqual({
    readResult: { __result: true, status: 'missing' },
    lastError: null,
  });
});

it('keeps replacement and functional write behavior unchanged for unreadable entries', () => {
  const backend = createMemoryStorage();
  backend.setItem('draft', 'unreadable original');
  const storage = createStorage({ storage: backend });
  const hook = renderHook(() =>
    useStorage(storage, 'draft', { diagnostics: true, defaultValue: 'fallback' }),
  );
  expect(hook.result.current[3].readResult.status).toBe('parse-error');
  act(() => hook.result.current[1]('replacement'));
  expect(storage.getItem('draft')).toBe('replacement');
  backend.setItem('draft', 'unreadable again');
  act(() => hook.result.current[1]((previous) => previous + '!'));
  expect(storage.getItem('draft')).toBe('fallback!');
  expect(hook.result.current[3].lastError).toBeNull();
});

it('reports read errors while functional mutations still throw and record schema/updater failures', async () => {
  const storage = createStorage({ storage: createMemoryStorage() });
  storage.setItem('draft', 'saved');
  const error = new Error('validation');
  const thrown: typeof schema = {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: () => {
        throw error;
      },
    },
  };
  const hook = renderHook(
    ({ active }) => useStorage(storage, 'draft', { schema: active, diagnostics: true }),
    { initialProps: { active: thrown } },
  );
  expect(hook.result.current[3].readResult).toEqual({
    __result: true,
    status: 'read-error',
    error,
  });
  const updater = vi.fn((value: string | null) => value ?? 'fallback');
  act(() => expect(() => hook.result.current[1](updater)).toThrow(error));
  expect(updater).not.toHaveBeenCalled();
  expect(hook.result.current[3].lastError).toEqual({ operation: 'write', error });
  hook.rerender({ active: schema });
  act(() =>
    expect(() =>
      hook.result.current[1](() => {
        throw error;
      }),
    ).toThrow(error),
  );
  expect(hook.result.current[3].lastError?.error).toBe(error);
  hook.rerender({
    active: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.reject(new Error('async')),
      },
    },
  });
  expect(hook.result.current[3].readResult).toMatchObject({
    status: 'read-error',
    error: expect.any(TypeError),
  });
  await Promise.resolve();
  expect(storage.getItem('draft')).toBe('saved');
});

it('reports async parser contracts as stable read errors without unhandled rejections', async () => {
  const backend = createMemoryStorage();
  backend.setItem('draft', 'saved bytes');
  const storage = createStorage({
    storage: backend,
    serializer: {
      stringify: JSON.stringify,
      parse: () => Promise.reject(new Error('async parser')),
    },
  });
  const hook = renderHook(() => useStorage(storage, 'draft', { diagnostics: true }));
  const result = hook.result.current[3].readResult;
  expect(result).toMatchObject({ status: 'read-error', error: expect.any(TypeError) });
  hook.rerender();
  expect(hook.result.current[3].readResult).toBe(result);
  await Promise.resolve();
  expect(backend.getItem('draft')).toBe('saved bytes');
});

it('reports unavailable storage with stable results and reconnects subscriptions when it recovers', () => {
  vi.stubGlobal('localStorage', undefined);
  const addListener = vi.spyOn(window, 'addEventListener');
  const removeListener = vi.spyOn(window, 'removeEventListener');
  const storage = createStorage();
  const hook = renderHook(() =>
    useStorage(storage, 'draft', { diagnostics: true, defaultValue: '' }),
  );
  const readResult = hook.result.current[3].readResult;
  expect(readResult.status).toBe('unavailable');
  expect(addListener.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(0);
  hook.rerender();
  expect(hook.result.current[3].readResult).toBe(readResult);
  act(() => expect(() => hook.result.current[1]('unsaved')).toThrow());
  expect(hook.result.current[3].lastError?.operation).toBe('write');
  const backend = createMemoryStorage();
  vi.stubGlobal('localStorage', backend);
  storage.setItem('draft', 'recovered');
  hook.rerender();
  expect(hook.result.current[0]).toBe('recovered');
  act(() => storage.setItem('draft', 'subscribed'));
  expect(hook.result.current[0]).toBe('subscribed');
  expect(addListener.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
  hook.unmount();
  expect(removeListener.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
});

it('preserves subscription setup errors without diagnostics', () => {
  const storage = createStorage({ storage: createMemoryStorage() });
  const error = new Error('subscription');
  vi.spyOn(storage, 'subscribe').mockImplementation(() => {
    throw error;
  });
  expect(() => renderHook(() => useStorage(storage, 'draft'))).toThrow(error);
});

it('clears a tracked mutation error after success even while diagnostics are disabled', () => {
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend });
  const hook = renderHook(({ enabled }) => useStorage(storage, 'draft', { diagnostics: enabled }), {
    initialProps: { enabled: true },
  });
  vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
    throw new Error('quota');
  });
  act(() => expect(() => hook.result.current[1]('unsaved')).toThrow('quota'));
  expect(hook.result.current[3]?.lastError?.operation).toBe('write');
  hook.rerender({ enabled: false });
  act(() => hook.result.current[1]('saved'));
  hook.rerender({ enabled: true });
  expect(hook.result.current[3]?.lastError).toBeNull();
});

it('preserves callback identities when toggling diagnostics and clears subscriptions and timers', () => {
  vi.useFakeTimers({ now: 1000 });
  const storage = createStorage({ storage: createMemoryStorage() });
  storage.setItem('a', 'one', { ttl: 10 });
  storage.setItem('b', 'two', { ttl: 20 });
  const hook = renderHook(
    ({ key, enabled }) =>
      useStorage(storage, key, { diagnostics: enabled, reactiveExpiration: true }),
    { initialProps: { key: 'a', enabled: false }, wrapper: StrictMode },
  );
  expect(hook.result.current).toHaveLength(3);
  const setter = hook.result.current[1];
  hook.rerender({ key: 'a', enabled: true });
  expect(hook.result.current).toHaveLength(4);
  expect(hook.result.current[1]).toBe(setter);
  expect(vi.getTimerCount()).toBe(1);
  act(() => {
    vi.advanceTimersByTime(11);
  });
  expect(hook.result.current[3]?.readResult).toEqual({
    __result: true,
    status: 'expired',
    expiresAt: 1010,
  });
  hook.rerender({ key: 'b', enabled: true });
  expect(vi.getTimerCount()).toBe(1);
  hook.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it('hydrates pending diagnostics before reading browser data without writing or deleting', async () => {
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend });
  storage.setItem('draft', 'saved');
  const reads = vi.spyOn(backend, 'getItem');
  const writes = vi.spyOn(backend, 'setItem');
  const removes = vi.spyOn(backend, 'removeItem');
  const statuses: string[] = [];
  function View() {
    const [value, , , diagnostics] = useStorage(storage, 'draft', {
      defaultValue: '',
      diagnostics: true,
    });
    statuses.push(diagnostics.readResult.status);
    return createElement('span', null, `${diagnostics.readResult.status}:${value}`);
  }
  const html = renderToString(createElement(View));
  expect(html).toBe('<span>pending:</span>');
  expect(reads).not.toHaveBeenCalled();
  const container = document.createElement('div');
  container.innerHTML = html;
  const errors = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, createElement(View), { onRecoverableError: errors });
  });
  expect(statuses.slice(0, 2)).toEqual(['pending', 'pending']);
  expect(container.textContent).toBe('success:saved');
  expect(errors).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(removes).not.toHaveBeenCalled();
  act(() => root.unmount());
});

it('keeps diagnostic recording enabled when a suspended render tries to disable it', async () => {
  const backend = createMemoryStorage();
  const storage = createStorage({ storage: backend });
  const pending = new Promise(() => {});
  let change!: (enabled: boolean) => void;
  let setter!: (value: string) => void;
  function View() {
    const [enabled, setEnabled] = useState(true);
    change = setEnabled;
    const [value, setValue, , diagnostics] = useStorage(storage, 'draft', {
      defaultValue: '',
      diagnostics: enabled,
    });
    if (!enabled) throw pending;
    setter = setValue;
    return createElement('span', null, diagnostics?.lastError ? 'failed' : value);
  }
  const view = render(createElement(Suspense, { fallback: 'loading' }, createElement(View)));
  await act(async () => {
    startTransition(() => change(false));
  });
  const error = new Error('quota');
  vi.spyOn(backend, 'setItem').mockImplementationOnce(() => {
    throw error;
  });
  act(() => expect(() => setter('unsaved')).toThrow(error));
  expect(view.container.textContent).toBe('failed');
  expect(storage.has('draft')).toBe(false);
});

it('infers nullable schema output and explicit/bound diagnostics without weakening existing return types', () => {
  const storage = createStorage({ storage: createMemoryStorage() });
  const bound = createStorageHook(storage);
  const nullable: StandardSchemaV1<unknown, string | null> = {
    '~standard': { ...schema['~standard'], validate: () => ({ value: null }) },
  };
  renderHook(() => {
    const direct = useStorage(storage, 'draft', {
      schema: nullable,
      defaultValue: '',
      diagnostics: true,
    });
    const shared = bound('draft', { schema: nullable, defaultValue: '', diagnostics: true });
    expectTypeOf(direct[0]).toEqualTypeOf<string>();
    expectTypeOf(shared[0]).toEqualTypeOf<string>();
    expectTypeOf(direct[3]).toEqualTypeOf<StorageDiagnostics<string | null>>();
    expectTypeOf(useStorage<number>(storage, 'n', { diagnostics: true })).toEqualTypeOf<
      UseStorageResult<number, number | null, true>
    >();
    expectTypeOf(bound<number>('n', { diagnostics: true })).toEqualTypeOf<
      UseStorageResult<number, number | null, true>
    >();
  });
});
