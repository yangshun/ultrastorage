---
title: 'Schema validation'
description: 'Validate and transform stored values with a synchronous Standard Schema.'
---

Persisted data can outlive the code that created it, and users or other scripts can change it. A
TypeScript type alone cannot guarantee that a stored value still has the shape your application
expects.

Schema validation checks values when you read them, helping you handle outdated or invalid data
before using it.

```ts
import { createStorage } from 'ultrastorage';

const appStorage = createStorage({ prefix: 'acme' });
```

Validate with any libraries that support [Standard Schema](https://github.com/standard-schema/standard-schema), as long as validation is synchronous.

```ts
import { z } from 'zod';

const UserSchema = z.object({ name: z.string(), age: z.number() });

// Returns typed value if valid, null if validation fails
const user = appStorage.getItem('user', { schema: UserSchema });
```

## Read semantics

Validation happens on read, not on write. Invalid data reported as schema issues returns `null` and
remains in storage.

Successful transformations return the schema output. Async schemas throw a TypeError, and
exceptions thrown by a schema propagate.

A TypeScript generic alone does not validate the persisted value. Browser storage can change outside your application, so use a schema when runtime validation matters.

For inferred React values and defaults, see [React schemas and types](/guides/react#schemas-and-types).
