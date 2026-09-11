---
title: 'How it works'
description: 'Understand the stored envelope, serialization, namespaces, and lazy expiration.'
---

`ultrastorage` wraps a `Storage` instance such as `localStorage` or `sessionStorage`. It serializes each value with metadata and provides typed methods for reading it.

## Internal entry format

Each stored value is wrapped in an internal envelope before being written to storage. That envelope includes a marker, a format version, your actual value, and an optional expiry timestamp.

The marker distinguishes ultrastorage entries from unrelated keys in `localStorage`. The envelope also adds TTL metadata without changing the stored value and leaves room for future format changes.

## Default serialization

By default, `ultrastorage` uses [`devalue`](https://github.com/sveltejs/devalue) instead of
`JSON.stringify()`.

JSON loses or changes useful JavaScript values such as
`Set`, `Map`, `Date`, `RegExp`, `BigInt`, `undefined`, `NaN`, and circular references.

The serializer is configurable. To use `superjson`, or plain JSON for a more
constrained setup, you can swap in your own `stringify` and `parse` methods and keep the rest of the
API unchanged.

If you bring your own serializer, import from `ultrastorage/core` to keep `devalue` out of your
bundle entirely.

## Expiration is lazy on read

TTL support is implemented as metadata on the entry, not as a background cleanup job.

When you call `getItem()`, expired entries are treated as missing and removed immediately. `has()`,
`key()`, `keys()`, and `length` also treat expired entries as missing, but they do not mutate storage.

Reads that need the value also perform cleanup. Bookkeeping operations remain side-effect free.

Call `clearExpired()` to remove expired entries proactively.

## Namespaces use prefix matching

When you pass a `prefix`, `ultrastorage` stores keys as `prefix + separator + key`. Namespace
operations match that full prefix string, so a broader prefix also includes matching nested
prefixes. Choose [non-overlapping prefixes](/guides/namespaces) for
independently managed data; an unprefixed instance matches recognized entries across the backend.

Array keys are serialized from their ordered string segments before the namespace prefix is added.
Their opaque JSON-based encoding preserves segment boundaries, empty strings, and separator
characters. It does not depend on the configured namespace separator.

`clear()` removes only recognized entries in that scope. Foreign data and unreadable envelopes
are skipped; see [clearing and migration](/reference/storage#clear).

## Why a factory, not a class

`createStorage()` returns a plain object built from a closure instead of a class instance. This keeps helper functions and configuration private, allows methods to be destructured without `this` binding issues, and makes the result easy to mock in tests.

The factory configures an ultrastorage instance around any object that implements `Storage`, including `localStorage`, `sessionStorage`, and the in-memory implementation.

## Why validation happens on read

Schema validation happens when values are read from storage. Browser storage can be modified outside the application, and data that was valid when written can become invalid after a schema change.

So `getItem(key, { schema })` validates the retrieved value right before your app uses it. If
validation fails, you get `null`.

If the schema is async, `ultrastorage` rejects it immediately rather than hiding asynchronous
behavior behind a synchronous storage API.
