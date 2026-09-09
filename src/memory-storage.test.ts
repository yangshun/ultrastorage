import { describe, expect, it } from 'vite-plus/test';
import { createMemoryStorage } from './memory-storage';

describe('memory storage', () => {
  it('returns null for out-of-range key indexes before and after removals', () => {
    const storage = createMemoryStorage();
    expect(storage.key(0)).toBeNull();

    storage.setItem('first', '1');
    storage.setItem('second', '2');
    expect(storage.key(0)).toBe('first');
    expect(storage.key(1)).toBe('second');
    expect(storage.key(-1)).toBeNull();
    expect(storage.key(2)).toBeNull();

    storage.removeItem('first');
    expect(storage.key(0)).toBe('second');
    expect(storage.key(1)).toBeNull();

    storage.clear();
    expect(storage.key(0)).toBeNull();
  });
});
