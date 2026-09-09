import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  pack: {
    deps: { resolveDepSubpath: true, neverBundle: ['react'] },
    entry: ['src/index.ts', 'src/core-entry.ts', 'src/react.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types.ts'],
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
