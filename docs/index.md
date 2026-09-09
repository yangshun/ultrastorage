---
title: 'ultrastorage'
description: 'Gives localStorage superpowers: rich values, expiration, namespaces, validation, and subscriptions.'
---

ultrastorage keeps the familiar Storage API and adds the features applications need. Use it directly from JavaScript or TypeScript, or subscribe from React.

## Install

```sh
npm install ultrastorage
```

## Store your first value

```ts
import { createStorage } from 'ultrastorage';

const storage = createStorage({ prefix: 'app' });
storage.setItem('user', { name: 'Alice', age: 30 });
storage.getItem<{ name: string; age: number }>('user');
// { name: 'Alice', age: 30 }
```

## What you can do

- [Store rich values](/guides/values), including Maps, Sets, Dates, and circular references.
- [Expire entries](/guides/expiration) with a TTL or absolute timestamp.
- [Namespace keys](/guides/namespaces) with prefixes and separators.
- [Subscribe to changes](/guides/subscriptions) within a page and across tabs.
- [Validate reads](/guides/validation) using synchronous Standard Schema libraries.
- [Choose a backend or serializer](/guides/backends), including an in-memory backend.
- [Use React hooks](/react) with typed defaults, functional updates, and SSR.

The package provides ESM, CJS, and TypeScript declarations. [Get started](/getting-started) or jump to the [storage API](/reference/storage).
