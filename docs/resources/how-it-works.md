---
title: 'How it works'
description: 'Understand the stored envelope, serialization, namespaces, and lazy expiration.'
---

`ultrastorage` is intentionally small. Under the hood, it's a thin wrapper around a `Storage` instance (e.g. `localStorage` / `sessionStorage`) that serializes your value together with a bit of metadata, then gives you a nicer API for reading it back safely.

## Internal entry format

Each stored value is wrapped in an internal envelope before being written to storage. That envelope includes a marker, a format version, your actual value, and an optional expiry timestamp.

This is what lets `ultrastorage` tell its own entries apart from random keys already sitting in `localStorage`, attach TTL metadata without changing your value shape, and leave room to evolve the format later without pretending raw strings are part of the contract.

## Serialization by default, not by accident

By default, `ultrastorage` uses [`devalue`](https://github.com/sveltejs/devalue) instead of `JSON.stringify()`. The point is not novelty. It's that JSON quietly loses or mangles useful JavaScript values like `Set`, `Map`, `Date`, `RegExp`, `BigInt`, `undefined`, `NaN`, and circular references.

The serializer is configurable on purpose. If you want `superjson`, or plain JSON for a more constrained setup, you can swap in your own `stringify` and `parse` methods and keep the rest of the API unchanged. If you bring your own serializer, import from `ultrastorage/core` to keep `devalue` out of your bundle entirely.

## Expiration is lazy on read

TTL support is implemented as metadata on the entry, not as a background cleanup job. When you call `getItem()`, expired entries are treated as missing and removed immediately. `has()`, `key()`, and `length` also treat expired entries as missing, but they do not mutate storage.

That split is deliberate. Reads that already need the value can pay the cleanup cost, while bookkeeping-style operations stay predictable and side-effect free. If you want to proactively sweep old entries, `clearExpired()` is the explicit escape hatch.

## Namespaces stay in their lane

When you pass a `prefix`, `ultrastorage` stores keys as `prefix + separator + key`. That isolates one logical namespace from another without requiring a separate `Storage` object.

It also means `clear()` only removes `ultrastorage` entries in the current namespace. Keys written by other code, or values that were never written by `ultrastorage` in the first place, are ignored rather than parsed opportunistically and guessed at.

## Why a factory, not a class

`createStorage()` returns a plain object built from a closure instead of an instance of a class. That keeps helper functions and configuration genuinely private, avoids `this` binding nonsense when methods are destructured, and makes the result easy to mock in tests.

It also matches the library's actual shape better: you're configuring an ultrastorage instance around any object that implements `Storage`, whether that's `localStorage`, `sessionStorage`, or the in-memory implementation.

## Why validation happens on read

Schema validation happens when values come back out of storage, not when they go in. That's the trust boundary that matters. Browser storage is user-tamperable, and even valid data at write time can become invalid later if your schema changes.

So `getItem(key, { schema })` validates the retrieved value right before your app uses it. If validation fails, you get `null`. If the schema is async, `ultrastorage` rejects it immediately rather than hiding asynchronous behavior behind a synchronous storage API.
