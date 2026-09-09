import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createMemoryStorage, createStorage } from './index';
import { useStorage } from './react';

afterEach(() => vi.unstubAllGlobals());

it('constructs default storage on the server without resolving a backend', () => {
  vi.stubGlobal('localStorage', undefined);
  const storage = createStorage();
  function View() {
    const [value] = useStorage(storage, 'n', { defaultValue: 'fallback' });
    return createElement('span', null, value);
  }
  expect(renderToString(createElement(View))).toBe('<span>fallback</span>');
  expect(() => storage.getItem('n')).toThrow();
  const backend = createMemoryStorage();
  vi.stubGlobal('localStorage', backend);
  storage.setItem('n', 2);
  vi.stubGlobal('localStorage', undefined);
  expect(storage.getItem('n')).toBe(2);
});

it('never reads explicit backend data during SSR and uses null without a default', () => {
  const backend = createMemoryStorage();
  const read = vi.spyOn(backend, 'getItem').mockImplementation(() => {
    throw new Error('No SSR reads');
  });
  const storage = createStorage({ storage: backend });
  function View() {
    const [value] = useStorage(storage, 'n');
    return createElement('span', null, String(value));
  }
  expect(renderToString(createElement(View))).toBe('<span>null</span>');
  expect(read).not.toHaveBeenCalled();
});
