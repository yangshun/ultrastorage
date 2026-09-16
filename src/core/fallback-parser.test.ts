import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from '../index';
import { createStorage as createCoreStorage } from '../core-entry';

const parseError = new Error('custom format marker missing');
const serializer = {
  stringify: (value: unknown) => `CUSTOM:${JSON.stringify(value)}`,
  parse: (raw: string) => {
    if (!raw.startsWith('CUSTOM:')) throw parseError;
    return JSON.parse(raw.slice('CUSTOM:'.length));
  },
};
const envelope = { __us: true, version: 1, value: 'admin', expiry: null };
const raw = JSON.stringify(envelope);

afterEach(() => vi.restoreAllMocks());

describe.each([
  ['default', createStorage],
  ['core', createCoreStorage],
] as const)('%s fallback parser', (_, create) => {
  it('preserves the custom parser error and stored bytes without an explicit fallback', () => {
    const backend = createMemoryStorage();
    backend.setItem('role', raw);
    const parse = vi.fn(serializer.parse);
    const storage = create({ storage: backend, serializer: { ...serializer, parse } });
    expect(storage.getItemResult('role')).toEqual({ status: 'parse-error', error: parseError });
    expect(parse).toHaveBeenCalledExactlyOnceWith(raw);
    expect(storage.getItem('role')).toBeNull();
    expect(backend.getItem('role')).toBe(raw);
  });

  it('tries an explicit fallback once after a throw and still validates the value', () => {
    const backend = createMemoryStorage();
    backend.setItem('role', raw);
    const fallbackParser = vi.fn(JSON.parse);
    const storage = create({ storage: backend, serializer, fallbackParser });
    expect(storage.getItemResult('role')).toEqual({ status: 'success', value: 'admin' });
    expect(fallbackParser).toHaveBeenCalledExactlyOnceWith(raw);
    const issues = [{ message: 'Role rejected' }];
    expect(
      storage.getItemResult('role', {
        schema: { '~standard': { version: 1, vendor: 'test', validate: () => ({ issues }) } },
      }),
    ).toEqual({ status: 'validation-error', issues });
    expect(backend.getItem('role')).toBe(raw);
    storage.setItem('role', 'user');
    expect(backend.getItem('role')).toBe(serializer.stringify({ ...envelope, value: 'user' }));
  });

  it('does not call either parser for missing entries or fallback after a returned result', () => {
    const backend = createMemoryStorage();
    const parse = vi.fn(serializer.parse);
    const fallbackParser = vi.fn(JSON.parse);
    const storage = create({
      storage: backend,
      serializer: { ...serializer, parse },
      fallbackParser,
    });
    expect(storage.getItemResult('missing')).toEqual({ status: 'missing' });
    expect(parse).not.toHaveBeenCalled();
    backend.setItem('role', serializer.stringify(envelope));
    expect(storage.getItemResult('role')).toEqual({ status: 'success', value: 'admin' });
    backend.setItem('role', serializer.stringify({}));
    expect(storage.getItemResult('role')).toEqual({ status: 'unsupported' });
    expect(fallbackParser).not.toHaveBeenCalled();
  });

  it('supports other fallback formats and preserves the original error if both parsers throw', () => {
    const backend = createMemoryStorage();
    const fallbackParser = vi.fn((value: string) => JSON.parse(value.slice('OLD:'.length)));
    const storage = create({ storage: backend, serializer, fallbackParser });
    backend.setItem('role', `OLD:${raw}`);
    expect(storage.getItemResult('role')).toEqual({ status: 'success', value: 'admin' });
    backend.setItem('role', 'broken');
    expect(storage.getItemResult('role')).toEqual({ status: 'parse-error', error: parseError });
    expect(backend.getItem('role')).toBe('broken');
    backend.setItem('role', 'OLD:{}');
    expect(storage.getItemResult('role')).toEqual({ status: 'unsupported' });
  });

  it.each([false, true])('uses the fallback policy across storage APIs: enabled=%s', (enabled) => {
    const backend = createMemoryStorage();
    const deadline = Date.now() + 60_000;
    const active = JSON.stringify({ ...envelope, expiry: deadline });
    const expired = JSON.stringify({ ...envelope, expiry: Date.now() - 1 });
    backend.setItem('app:active', active);
    backend.setItem('app:expired', expired);
    backend.setItem('other:active', active);
    const storage = create({
      storage: backend,
      prefix: 'app',
      serializer,
      fallbackParser: enabled ? JSON.parse : undefined,
    });
    expect(storage.has('active')).toBe(enabled);
    expect(storage.length).toBe(enabled ? 1 : 0);
    expect(storage.key(0)).toBe(enabled ? 'active' : null);
    expect(storage.keys()).toEqual(enabled ? ['active'] : []);
    expect(storage.getExpiration('active')).toEqual(enabled ? { expiresAt: deadline } : null);
    storage.clearExpired();
    expect(backend.getItem('app:expired')).toBe(enabled ? null : expired);
    expect(storage.setExpiration('active', { expiresAt: deadline + 1 })).toBe(enabled);
    if (enabled) {
      expect(serializer.parse(backend.getItem('app:active')!).expiry).toBe(deadline + 1);
    }
    // Restore JSON bytes so clear must consult the fallback policy independently.
    backend.setItem('app:active', active);
    storage.clear();
    expect(backend.getItem('app:active')).toBe(enabled ? null : active);
    expect(backend.getItem('other:active')).toBe(active);
    storage.removeItem('active');
    expect(backend.getItem('app:active')).toBeNull();
  });

  describe.each(['primary', 'fallback'] as const)('%s async parser', (position) => {
    it.each(['resolved promise', 'rejected promise', 'object thenable', 'function thenable'])(
      'rejects a %s synchronously without an unhandled rejection',
      async (kind) => {
        const backend = createMemoryStorage();
        backend.setItem('role', raw);
        const parse = () => {
          if (kind === 'resolved promise') return Promise.resolve(envelope);
          if (kind === 'rejected promise') return Promise.reject(parseError);
          const then = (_resolve: unknown, reject: (error: unknown) => void) => reject(parseError);
          // oxlint-disable-next-line unicorn/no-thenable -- Intentional thenables test unsupported async parsers.
          return kind === 'object thenable' ? { then } : Object.assign(() => {}, { then });
        };
        const fallbackParser = vi.fn(position === 'fallback' ? parse : JSON.parse);
        const storage = create({
          storage: backend,
          serializer: position === 'primary' ? { ...serializer, parse } : serializer,
          fallbackParser,
        });
        expect(() => storage.getItemResult('role')).toThrow(TypeError);
        expect(fallbackParser).toHaveBeenCalledTimes(position === 'fallback' ? 1 : 0);
        expect(backend.getItem('role')).toBe(raw);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    );
  });
});

it('requires explicit JSON compatibility with the default devalue serializer too', () => {
  const backend = createMemoryStorage();
  backend.setItem('role', raw);
  const strict = createStorage({ storage: backend });
  const compatible = createStorage({ storage: backend, fallbackParser: JSON.parse });
  expect(strict.getItemResult('role').status).toBe('parse-error');
  expect(compatible.getItemResult('role')).toEqual({ status: 'success', value: 'admin' });
});
