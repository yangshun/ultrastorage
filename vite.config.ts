import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  pack: {
    deps: { resolveDepSubpath: true, neverBundle: ['react'] },
    entry: {
      index: 'src/index.ts',
      'core-entry': 'src/core-entry.ts',
      react: 'src/react/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/core/types.ts'],
      reporter: ['text', 'html', 'json', 'json-summary'],
      skipFull: false,
      thresholds: { 100: true, perFile: true },
    },
  },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    printWidth: 100,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    bracketSpacing: true,
    sortPackageJson: true,
    ignorePatterns: [],
  },
});
