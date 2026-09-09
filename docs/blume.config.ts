import { defineConfig } from 'blume';

export default defineConfig({
  title: 'ultrastorage',
  description:
    'Gives localStorage superpowers: rich values, expiration, namespaces, schema validation, and subscriptions.',
  content: {
    root: '.',
    include: ['*.md', 'guides/*.md', 'react/*.md', 'reference/*.md'],
  },
  github: { owner: 'yangshun', repo: 'ultrastorage', branch: 'main', dir: 'docs' },
  logo: { image: '/icon.svg', text: 'ultrastorage' },
  theme: { accent: 'green', mode: 'system' },
  navigation: {
    sidebar: [
      '/',
      '/getting-started',
      {
        label: 'Guides',
        items: [
          '/guides/values',
          '/guides/expiration',
          '/guides/namespaces',
          '/guides/subscriptions',
          '/guides/validation',
          '/guides/backends',
        ],
      },
      {
        label: 'React',
        items: ['/react', '/react/schemas', '/react/snapshots', '/react/server-rendering'],
      },
      {
        label: 'Reference',
        items: [
          '/reference/storage',
          '/reference/caveats',
          '/reference/how-it-works',
          '/reference/alternatives',
        ],
      },
      '/contributing',
    ],
    actions: [{ label: 'npm', href: 'https://www.npmjs.com/package/ultrastorage' }],
  },
  search: { provider: 'orama' },
  ai: { llmsTxt: true },
  deployment: { output: 'static' },
});
