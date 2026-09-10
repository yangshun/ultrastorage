---
title: 'Reading and writing values'
description: 'Store rich JavaScript values, add TypeScript types, and initialize or update entries.'
---

`localStorage` only stores strings, so saving objects means repeatedly serializing and parsing them. Plain JSON also loses types such as `Date`, `Map`, and `Set`. ultrastorage handles serialization for you, letting you read and write JavaScript values directly, with helpers for initializing and updating stored data.

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'my-app' });
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

TypeScript can't read `localStorage` at compile time (yet), but you can at least pretend your data is typed.

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

However, the true safe way is to validate with a [schema during read](/guides/validation).

## Initialize a value

Get the value if it exists, or writes to storage if it doesn't. Either way, you're getting something back.

```ts
const prefs = appStorage.getOrInit('prefs', () => ({
  theme: 'light',
  lang: 'en',
}));
```

## Update a value

Read-modify-write in one call. Three separate statements was apparently too much work even when AI is writing all the code.

```ts
appStorage.updateItem<number>('count', (current) => (current ?? 0) + 1);
```

## Check, remove, and clear

The usual housekeeping. Someone has to take out the trash.

```ts
appStorage.has('user'); // true
appStorage.removeItem('user');
appStorage.has('user'); // false

appStorage.clear(); // remove all entries written by `ultrastorage`
appStorage.clearExpired(); // remove only expired entries
```
