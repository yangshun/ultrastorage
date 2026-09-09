---
title: 'Development'
description: 'Run checks, build the package, and maintain the Blume documentation website.'
---

This project uses [Vite+](https://viteplus.dev/guide/) with the Node.js version in
`.node-version` and the package manager declared in `package.json`.

```sh
vp install
vp check
vp test run
vp run test:coverage # enforces 100% runtime coverage
vp pack
```

Use `vp pack` or `vp run build` to build this library, including ESM, CJS, and
TypeScript declarations. `vp build` runs Vite's application build and expects an
HTML entry point. Formatting, linting, and packaging options live in `vite.config.ts`.

## Documentation website

The source pages are plain Markdown in `docs/`. Blume reads `docs/blume.config.ts` and generates navigation, syntax highlighting, local search, and static pages.

Run these commands from the repository root:

```sh
vp run docs:dev
vp run docs:validate
vp run docs:build
vp run docs:preview
```

The site builds to `docs/dist/`. The package still builds to the root `dist/` with `vp pack`; neither build replaces the other. Generated `.blume/` directories and website output are ignored by Git and excluded from the npm package.

Each page starts with `title` and `description` frontmatter. Begin the body with level-two headings because Blume supplies the page title. Add new page routes to the sidebar in `docs/blume.config.ts`. Use root-relative website links, such as `/guides/expiration`, and run `docs:validate` to check routes and anchors. Use repository URLs for files that are not website pages.

## Hosting the static site

Configure a static host to install development dependencies, run `vp run docs:build`, and publish `docs/dist`. The repository pins its Node and package-manager versions. Install Vite+ on the build host, or run the underlying `blume build` command from `docs/` with the package manager's script environment.

Blume can infer the production site URL on supported hosts. Set `deployment.site` in `docs/blume.config.ts` when a canonical domain is known. For a project hosted below a URL path, also set `deployment.base`. No deployment domain is assumed by this repository.

See the [Blume deployment guide](https://useblume.dev/docs/deployment) for host-specific settings, and the [package spec](https://github.com/yangshun/greatstorage/blob/main/SPEC.md) and [changelog](https://github.com/yangshun/greatstorage/blob/main/CHANGELOG.md) for design and release notes.
