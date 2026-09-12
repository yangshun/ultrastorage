---
title: 'Caveats'
description: 'Understand storage limits, synchronization boundaries, invalid data, and other tradeoffs.'
---

Adding a storage wrapper does not remove browser storage limits or make existing data automatically
compatible.

Before adopting ultrastorage, understand how it handles failed reads, expiration, and
notifications. These details help you avoid unexpected behavior. If you are changing storage
formats or libraries, see the separate [migration guide](/guides/migration).

- **Namespaces can overlap**: A broad prefix includes matching nested prefixes, while an unprefixed instance can clear recognized entries across the backend; choose [non-overlapping prefixes](/guides/namespaces).
- **Namespace changes need migration**: Changing `prefix` or `separator` does not rename existing entries and can make them inaccessible through the new configuration; keep [namespace settings](/guides/namespaces) stable or migrate the data explicitly.
- **Reads and writes can throw**: Synchronous backend access, quota, serialization, and thrown schema errors propagate without a memory fallback; even expiration cleanup during a read can fail ([error handling](/reference/storage#error-handling)).
- **Clearing skips unreadable entries**: Corrupted or unsupported envelopes can remain in storage after `clear()` and require [explicit migration or removal](/reference/storage#clear).
- **Changing serializers can strand data**: JSON fallback runs only when the configured parser throws, so use a new prefix and plan [format migration](/guides/destinations#custom-serialization).
- **Rich values have limits**: Functions, promises, symbols, and arbitrary class instances are rejected by default, while custom serializers may lose other values ([serialization limits](/guides/destinations#custom-serialization)).
- **Existing raw values need migration**: Plain-string and plain-JSON entries are invisible until [imported with a legacy read](/guides/migration#importing-existing-values).
- **`null` has several meanings**: Missing, expired, foreign, unparseable, schema-invalid, and stored-null values can all read as `null`; use [`has()`](/reference/storage#has) to distinguish a recognized stored-null entry from an absent one.
- **Presence does not imply validity**: Bookkeeping and core helpers do not apply a schema; use [explicit read validation](/guides/validation#read-semantics).
- **Ordinary read validation does not rewrite storage**: Synchronous schemas leave invalid entries untouched and return transformations without saving them, while [React setters must write values the schema accepts](/guides/react#schemas-and-types).
- **Helpers are synchronous and non-atomic**: Factories and updaters are not awaited, and read-modify-write operations can race across tabs or callers ([helper semantics](/guides/values#update-a-value)).
- **Initialization can run again**: Stored `null` causes `getOrInit()` to call its factory again, and returning an existing value does not refresh its TTL ([initialization](/guides/values#initialize-a-value)).
- **Updates preserve expiration**: An `updateItem()` call without expiration options keeps the current unexpired deadline. Pass `{ expiresAt: null }` to remove it ([updating values](/guides/values#update-a-value)).
- **Expiration is lazy by default**: Opt in to [reactive expiration](/guides/expiration#reactive-expiration) for timer notifications. Timers do not delete entries, which can occupy storage until cleanup.
- **Same-page notifications require the same runtime**: Direct backend writes do not notify locally, and separately loaded package copies or mixed ESM/CJS runtimes do not share a registry ([subscriptions](/guides/subscriptions)).
- **Use the React adapter for rendering**: Ordinary reads return fresh objects and can delete expired entries, while the adapter supplies [cached, side-effect-free snapshots](/guides/react#snapshots-and-expiration).
- **Some string keys alias array keys**: Strings matching the [reserved array-key encoding](/reference/storage#reserved-array-key-encoding) address array keys and are returned as arrays during enumeration.
