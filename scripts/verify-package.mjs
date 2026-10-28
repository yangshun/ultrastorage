import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodeProcess = globalThis.process;

function verify(module) {
  const backend = module.createMemoryStorage();
  const storage = module.createStorage({ storage: backend, prefix: 'smoke' });
  storage.setItem('smoke-test', 'ok');
  if (storage.getItem('smoke-test') !== 'ok') {
    throw new Error('Built package failed its storage smoke test.');
  }
  backend.setItem('old', 'imported');
  const result = storage.getItem('imported', {
    detailed: true,
    migrateFrom: { key: 'old', deserialize: (raw) => ({ value: raw }) },
  });
  if (
    !result.__result ||
    result.status !== 'success' ||
    result.value !== 'imported' ||
    result.migrated !== true ||
    backend.getItem('old') !== 'imported' ||
    'getItemResult' in storage
  ) {
    throw new Error('Built package failed its detailed importing read smoke test.');
  }
}

try {
  delete globalThis.process;
  verify(await import('../dist/index.mjs'));
  verify(require('../dist/index.cjs'));
} finally {
  globalThis.process = nodeProcess;
}
