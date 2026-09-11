import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

describe('production mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  it.each([
    { prefix: 'app:admin', separator: undefined },
    { prefix: 'app/admin', separator: '/' },
  ])('allows prefix $prefix without warnings', async ({ prefix, separator }) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { createStorage, createMemoryStorage } = await import('./index');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const backend = createMemoryStorage();
    const storage = createStorage({ storage: backend, prefix, separator });

    storage.setItem('theme', 'dark');
    expect(storage.getItem('theme')).toBe('dark');
    expect(backend.key(0)).toBe(`${prefix}${separator ?? ':'}theme`);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stores, initializes, and expires values without development warnings', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    vi.useFakeTimers({ now: 1000 });
    // Import after changing NODE_ENV to exercise production initialization too.
    const { createStorage, createMemoryStorage } = await import('./index');
    const storage = createStorage({ storage: createMemoryStorage() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    storage.setItem('nullable', null);
    expect(storage.has('nullable')).toBe(true);
    expect(storage.getItem('nullable')).toBeNull();

    storage.setItem('expired', 'old', { ttl: -1 });
    expect(storage.getItem('expired')).toBeNull();

    expect(storage.getOrInit('null-init', () => null)).toBeNull();
    expect(storage.has('null-init')).toBe(true);
    expect(storage.getOrInit('initialized', () => 'new')).toBe('new');
    expect(storage.getItem('initialized')).toBe('new');
    expect(warn).not.toHaveBeenCalled();
  });
});
