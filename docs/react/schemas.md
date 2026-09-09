---
title: 'Schemas and types'
description: 'Infer hook values from defaults or Standard Schema output and validate persisted data.'
---

The examples use the bound `usePreferences` hook from [React setup](/react).

Use any synchronous Standard Schema implementation. For example, if your app uses Zod:

```tsx
import { z } from 'zod';
import { usePreferences } from './preferences';

const UserSchema = z.object({ name: z.string(), age: z.number() });

export function Profile() {
  const [user, setUser, removeUser] = usePreferences('user', { schema: UserSchema });
  // user: { name: string; age: number } | null
  return (
    <>
      <p>{user?.name ?? 'No profile saved'}</p>
      <button onClick={() => setUser({ name: 'Alice', age: 30 })}>Save profile</button>
      <button onClick={removeUser}>Remove profile</button>
    </>
  );
}
```

The schema determines the value and setter types. Without a schema, provide a generic such as `usePreferences<User>('user')` or let a default infer the type. Generics provide compile-time types only; schemas also validate the stored data at runtime. A non-null, non-undefined default removes `null` even when the schema itself accepts null. Schema transformations apply before rendering and before a functional updater receives its input.
