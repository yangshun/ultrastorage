import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nodeProcess = globalThis.process;

function verify(module) {
  const storage = module.createStorage({ storage: module.createMemoryStorage() });
  storage.setItem('smoke-test', 'ok');
  if (storage.getItem('smoke-test') !== 'ok') {
    throw new Error('Built package failed its storage smoke test.');
  }
}

try {
  delete globalThis.process;
  verify(await import('../dist/index.mjs'));
  verify(require('../dist/index.cjs'));
} finally {
  globalThis.process = nodeProcess;
}
