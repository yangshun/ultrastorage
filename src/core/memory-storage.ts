export function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  // Reuse the ordered keys across enumeration until an insertion or deletion changes them.
  let keys: string[] | undefined;
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!store.has(key)) keys = undefined;
      store.set(key, value);
    },
    removeItem: (key: string) => {
      if (store.delete(key)) keys = undefined;
    },
    clear: () => {
      store.clear();
      keys = undefined;
    },
    get length() {
      return store.size;
    },
    key: (index: number) => (keys ??= [...store.keys()])[index] ?? null,
  };
}
