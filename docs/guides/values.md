---
title: 'Reading and writing values'
description: 'Store rich JavaScript values, add TypeScript types, and initialize or update entries.'
---

```ts
import { createStorage } from 'ultrastorage';

const storage = createStorage();
```

## Rich values

Yes, `localStorage` can finally handle a `Set`, or any data type you throw at it. It only took the entire JavaScript ecosystem to get here.

Uses [devalue](https://github.com/sveltejs/devalue) by default, but you can bring your own serializer.

```ts
storage.setItem('tags', new Set(['a', 'b', 'c']));
storage.getItem('tags'); // Set {'a', 'b', 'c'}

storage.setItem('metadata', new Map([['key', 'value']]));
storage.getItem('metadata'); // Map {'key' => 'value'}

storage.setItem('date', new Date('2025-01-01'));
storage.getItem('date'); // Date 2025-01-01T00:00:00.000Z
```

## TypeScript types

TypeScript can't read `localStorage` at compile time (yet), but you can at least pretend your data is typed.

```ts
interface User {
  name: string;
  age: number;
}

const user = storage.getItem<User>('user');
// user is typed as User | null

storage.getOrInit<User>('user', () => ({ name: 'Alice', age: 30 }));

storage.updateItem<User>('user', (current) => ({
  ...current!,
  age: current!.age + 1,
}));
```

However, the true safe way is to validate with a [schema during read](/guides/validation).

## Initialize a value

Get the value if it exists, or writes to storage if it doesn't. Either way, you're getting something back.

```ts
const prefs = storage.getOrInit('prefs', () => ({
  theme: 'light',
  lang: 'en',
}));
```

## Update a value

Read-modify-write in one call. Three separate statements was apparently too much work even when AI is writing all the code.

```ts
storage.updateItem<number>('count', (current) => (current ?? 0) + 1);
```

## Check, remove, and clear

The usual housekeeping. Someone has to take out the trash.

```ts
storage.has('user'); // true
storage.removeItem('user');
storage.has('user'); // false

storage.clear(); // remove all entries written by `ultrastorage`
storage.clearExpired(); // remove only expired entries
```
