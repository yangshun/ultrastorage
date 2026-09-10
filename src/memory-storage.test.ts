import { describe, expect, it, vi } from 'vite-plus/test';
import { createStorage } from './core-entry';
import { createMemoryStorage } from './memory-storage';

describe('memory storage', () => {
  it('keeps key order current across insertions, overwrites, deletions, and clear', () => {
    const storage = createMemoryStorage();
    storage.setItem('first', '1');
    expect(storage.key(0)).toBe('first');

    storage.setItem('second', '2');
    expect(storage.key(1)).toBe('second');
    storage.setItem('first', 'updated');
    expect(storage.key(0)).toBe('first');
    expect(storage.getItem('first')).toBe('updated');

    storage.removeItem('missing');
    expect(storage.key(1)).toBe('second');
    storage.removeItem('first');
    expect(storage.key(0)).toBe('second');
    storage.setItem('first', 'reinserted');
    expect(storage.key(1)).toBe('first');

    storage.clear();
    expect(storage.key(0)).toBeNull();
    storage.setItem('third', '3');
    expect(storage.key(0)).toBe('third');
    expect(storage.key(1)).toBeNull();
  });

  it('enumerates stored keys with linear work when counting entries', () => {
    const storage = createStorage({ storage: createMemoryStorage(), serializer: JSON });
    const size = 1000;
    for (let index = 0; index < size; index++) storage.setItem(String(index), index);

    let visited = 0;
    // oxlint-disable-next-line typescript/unbound-method -- Explicitly rebound with call below.
    const originalKeys = Map.prototype.keys;
    const keys = vi
      .spyOn(Map.prototype, 'keys')
      .mockImplementation(function (this: Map<unknown, unknown>) {
        const iterator = originalKeys.call(this);
        const next = iterator.next.bind(iterator);
        iterator.next = () => {
          const result = next();
          if (!result.done) visited++;
          return result;
        };
        return iterator;
      });
    let length: number;
    try {
      length = storage.length;
    } finally {
      keys.mockRestore();
    }

    expect(length).toBe(size);
    expect(visited).toBeLessThanOrEqual(size * 2);
  });

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
