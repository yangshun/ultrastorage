---
title: 'Snapshots and expiration'
description: 'Keep React values stable and update rich objects without render-time storage mutations.'
---

Hook values retain object identity while their stored representation and schema stay unchanged. Treat returned objects as immutable, including Maps, Sets, and Dates. Return replacement values from updaters (for example, `previous => new Set([...previous, 'new'])`) instead of mutating the previous value. No deep freeze is applied. Inline schemas and object defaults are supported, but recreating them can change projected value identity.

Rendering never deletes expired entries or writes defaults. There are no expiration timers: a mounted component is not scheduled to render just because time passes. A subsequent snapshot read recognizes expiration; `getItem()` or `clearExpired()` performs actual cleanup and notifies listeners. A direct backend write schedules no same-page render, although a later snapshot read can observe it.

## Replace rich values

```tsx
// Inside a component; usePreferences is defined in the React setup guide.
const [tags, setTags] = usePreferences<Set<string>>('tags');

function addTag(tag: string) {
  setTags((previous) => new Set([...(previous ?? []), tag]));
}
```

The updater receives the latest persisted value. It must return a replacement instead of mutating a previously rendered object. See [React setup](/react) for the bound hook.
