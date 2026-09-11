---
title: 'Reading and writing values'
description: 'Store rich JavaScript values, add TypeScript types, and initialize or update entries.'
---

`localStorage` only stores strings, so saving objects means repeatedly serializing and parsing them.
Plain JSON also loses types such as `Date`, `Map`, and `Set`.

ultrastorage handles serialization for you, letting you read and write JavaScript values directly,
with helpers for initializing and updating stored data.

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'acme' });
```

## Rich values

Uses [devalue](https://github.com/sveltejs/devalue) by default, but you can bring your own serializer.

```ts
appStorage.setItem('tags', new Set(['a', 'b', 'c']));
appStorage.getItem('tags'); // Set {'a', 'b', 'c'}

appStorage.setItem('metadata', new Map([['key', 'value']]));
appStorage.getItem('metadata'); // Map {'key' => 'value'}

appStorage.setItem('date', new Date('2025-01-01'));
appStorage.getItem('date'); // Date 2025-01-01T00:00:00.000Z
```

## TypeScript types

Pass a type argument to describe the expected shape of a stored value.

```ts
interface User {
  name: string;
  age: number;
}

const user = appStorage.getItem<User>('user');
// user is typed as User | null

appStorage.getOrInit<User>('user', () => ({ name: 'Alice', age: 30 }));

appStorage.updateItem<User>('user', (current) => ({
  ...current!,
  age: current!.age + 1,
}));
```

Type arguments do not validate stored data at runtime. Use a [schema during read](/guides/validation)
when validation is required.

## Initialize a value

`getOrInit()` returns the existing value when present. Otherwise, it creates, stores, and returns a
new value.

```ts
const prefs = appStorage.getOrInit('prefs', () => ({
  theme: 'light',
  lang: 'en',
}));
```

## Update a value

Read, modify, and write a value in one call.

```ts
appStorage.updateItem<number>('count', (current) => (current ?? 0) + 1);
```

## Array keys

Use an array of strings when several values belong to the same entity or scope:

```ts
const userId = '42';

appStorage.setItem(['users', userId, 'profile'], {
  name: 'Alice',
});
appStorage.setItem(['users', userId, 'preferences'], {
  theme: 'dark',
});

appStorage.getItem(['users', userId, 'profile']);
// { name: 'Alice' }

appStorage.getItem(['users', userId, 'preferences']);
// { theme: 'dark' }
```

Equivalent arrays address the same entry, so you do not need to reuse the same array instance:

```ts
appStorage.setItem(['documents', 'draft'], 'Hello');
appStorage.getItem(['documents', 'draft']); // 'Hello'
```

Array keys preserve segment boundaries, so separator characters inside a segment do not change the
key's structure:

```ts
appStorage.setItem(['users', 'a:b'], 'first');
appStorage.setItem(['users:a', 'b'], 'second');

appStorage.getItem(['users', 'a:b']); // 'first'
appStorage.getItem(['users:a', 'b']); // 'second'
```

See [`StorageKey`](/reference/storage#storagekey) for the complete key contract.

## Check, remove, and clear

The usual housekeeping.

```ts
appStorage.has('user'); // true
appStorage.removeItem('user');
appStorage.has('user'); // false

appStorage.clear(); // remove all entries written by `ultrastorage`
appStorage.clearExpired(); // remove only expired entries
```
