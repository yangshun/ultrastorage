---
title: 'Server rendering and errors'
description: 'Render matching server defaults, hydrate persisted values, and handle storage failures.'
---

`createStorage()` defers access to the default `localStorage` until an operation needs it, so module-level construction is safe on the server. The hooks render the default (or `null`) on the server and during initial hydration without reading any backend, including explicit memory backends. They switch to persisted browser data after hydration. Provide matching defaults on the server and client; there is no automatic server-data transfer. Only instance construction is safe without a backend: calling ordinary storage methods still requires an available backend.

Storage access, quota, serialization-on-write, updater, and thrown schema errors propagate. Async schemas throw. Validation failures reported as schema issues use the fallback. There is no optimistic update or silent fallback to memory after a failed write or inaccessible browser storage. Render-time errors can be handled by a React error boundary; handle setter errors in the calling event handler.

The adapter exports `UseStorageOptions`, `UseStorageResult`, `StorageSetter`, and `StorageHook` types. It does not add a provider, public snapshot API, selector, or `useStorageValue` hook.
