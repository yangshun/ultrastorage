import { defineConfig } from 'blume';

export default defineConfig({
  title: 'ultrastorage',
  description:
    'Gives localStorage superpowers: rich values, expiration, namespaces, schema validation, and subscriptions.',
  content: {
    root: '.',
    include: [
      '*.md',
      '*.mdx',
      'guides/*.md',
      'guides/*.mdx',
      'reference/*.md',
      'reference/*.mdx',
      'resources/*.md',
    ],
  },
  github: { owner: 'yangshun', repo: 'ultrastorage', branch: 'main', dir: 'docs' },
  logo: {
    image: { light: '/icon.svg', dark: '/icon-dark.svg', alt: 'ultrastorage' },
    text: 'ultrastorage',
  },
  theme: {
    accent: '#6d5dfc',
    mode: 'system',
  },
  navigation: {
    sidebar: [
      '/getting-started',
      {
        label: 'Guides',
        items: [
          '/guides/values',
          '/guides/namespaces',
          '/guides/expiration',
          '/guides/validation',
          '/guides/destinations',
          '/guides/subscriptions',
          '/guides/react',
          '/guides/caveats',
        ],
      },
      {
        label: 'Reference',
        items: ['/reference/storage', '/reference/react'],
      },
      {
        label: 'Resources',
        items: ['/resources/changelog', '/resources/how-it-works', '/resources/alternatives'],
      },
    ],
  },
  search: { provider: 'orama' },
  ai: { llmsTxt: true },
  deployment: { output: 'static', site: 'https://ultrastorage.dev' },
});
