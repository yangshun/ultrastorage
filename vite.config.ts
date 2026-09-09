import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  pack: {
    deps: { resolveDepSubpath: true },
    entry: ['src/index.ts', 'src/core-entry.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
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
