---
title: 'React'
description: 'Consume storage and respond to changes with useStorage and createStorageHook.'
---

React 18 and 19 are supported through the `greatstorage/react` entry point in the same package. React and its types are optional peers: applications using only the main or core entry point do not need React installed.

In an existing React application, install `greatstorage` and import the adapter from `greatstorage/react`. There is no separate adapter package to install.

## `createStorageHook(storage): StorageHook`

Bind a GreatStorage instance once, then call the returned hook with a key and optional read options. The bound hook uses that instance's backend, prefix, separator, and serializer. Create it outside components; no provider is required.

```tsx
// preferences.ts — create instances and bound hooks outside components
import { createStorage } from 'greatstorage';
import { createStorageHook } from 'greatstorage/react';

export const preferences = createStorage({ prefix: 'app' });
export const usePreferences = createStorageHook(preferences);
```

```tsx
// ThemePicker.tsx — use a Client Component in an RSC framework
'use client';
import { usePreferences } from './preferences';

export function ThemePicker() {
  const [theme, setTheme, removeTheme] = usePreferences('theme', {
    defaultValue: 'light',
  });

  return (
    <>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>Theme: {theme}</button>
      <button onClick={removeTheme}>Reset</button>
    </>
  );
}
```

Components using the same key respond to writes through the hook, ordinary GreatStorage methods, other instances sharing the backend, and browser storage events from other tabs.

For a component that only displays a value, destructure the first tuple item:

```tsx
import { usePreferences } from './preferences';

export function CurrentTheme() {
  const [theme] = usePreferences('theme', { defaultValue: 'light' });
  return <p>Current theme: {theme}</p>;
}
```

Mounting `ThemePicker` and `CurrentTheme` anywhere in the same app keeps both in sync. Calling `preferences.setItem('theme', 'dark')` outside React also updates them. Defaults belong to each hook call: two consumers can display different defaults while the key is absent, so reuse the same default when they should agree.

## `useStorage(storage, key, options?)`

The direct hook is equivalent to a bound hook:

```tsx
import { useStorage } from 'greatstorage/react';
import { preferences } from './preferences';

function Counter() {
  const [count, setCount, removeCount] = useStorage<number>(preferences, 'count', {
    defaultValue: 0,
  });
  return (
    <>
      <button onClick={() => setCount((previous) => previous + 1)}>Count: {count}</button>
      <button onClick={() => setCount(0, { ttl: 60_000 })}>Reset for one minute</button>
      <button onClick={removeCount}>Remove</button>
    </>
  );
}
```

Both hooks return a readonly `[value, setValue, removeValue]` tuple. `setValue(valueOrUpdater, storageOptions?)` accepts the existing `ttl` or `expiresAt` options; omitted expiration options write a non-expiring entry. Functional updates read the latest persisted value, apply schema validation and the fallback, then write the result. They are synchronous but are not atomic across tabs. `removeValue()` removes the entry and restores the displayed default.

| Option         | Behavior                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `defaultValue` | Display-only fallback when the read returns `null`; never automatically written. An omitted or `undefined` default uses `null`. |
| `schema`       | Synchronous Standard Schema validation and transformation, matching `getItem()`. Infer the value type from its output.          |

Missing, expired, foreign, unparseable, invalid, and stored-null values use the fallback. Valid stored `undefined` remains `undefined`. A non-null default removes `null` from the inferred value and updater input types. Defaults should match the schema output type; defaults themselves are not validated. Setter input uses that same output type, and writes are not schema-validated.

Setter and remover identities remain stable while the storage instance and key stay the same. Changes to hook options apply after commit; switching instances or keys switches subscriptions. Use factory-created GreatStorage instances from `greatstorage` or `greatstorage/core`; structural mocks or independently loaded package copies are not supported by the private snapshot bridge. For tests, wrap `createMemoryStorage()` with `createStorage()`.

## Next steps

- [Schemas and types](/react/schemas).
- [Snapshots and expiration](/react/snapshots).
- [Server rendering and errors](/react/server-rendering).
