// @vitest-environment jsdom
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { createMemoryStorage, createStorage } from './index';
import type { UltraStorage } from './types';

describe('schema result boundaries', () => {
  let storage: UltraStorage;
  let frame: HTMLIFrameElement;
  let foreignPromise: PromiseConstructor;

  beforeEach(() => {
    storage = createStorage({ storage: createMemoryStorage() });
    storage.setItem('count', 42);
    frame = document.createElement('iframe');
    document.body.append(frame);
    foreignPromise = (frame.contentWindow as Window & typeof globalThis).Promise;
  });

  afterEach(() => frame.remove());

  function readResult(result: unknown) {
    const schema: StandardSchemaV1<unknown, number> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        // Exercise results supplied by external schema implementations at runtime.
        validate: () =>
          result as ReturnType<StandardSchemaV1<unknown, number>['~standard']['validate']>,
      },
    };
    return storage.getItem('count', { schema });
  }

  it('rejects a resolved promise from another realm synchronously', () => {
    const result = foreignPromise.resolve({ value: 42 });
    expect(result).not.toBeInstanceOf(Promise);
    expect(() => readResult(result)).toThrow(
      'Schema validation must be synchronous. Async schemas are not supported.',
    );
  });

  it('consumes rejections from promises created in another realm', async () => {
    const result = foreignPromise.reject(new Error('Foreign rejection'));
    expect(result).not.toBeInstanceOf(Promise);
    expect(() => readResult(result)).toThrow('Schema validation must be synchronous');
    // Give unhandled rejections a turn to surface to the test runner.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem('count')).toBe(42);
  });

  it.each(['object', 'function'] as const)(
    'consumes rejections from a %s thenable',
    async (kind) => {
      const then = vi.fn((_resolve: unknown, reject: (reason: unknown) => void) => {
        reject(new Error('Thenable rejection'));
      });
      // oxlint-disable-next-line unicorn/no-thenable -- Intentional thenables exercise async schema rejection.
      const result = kind === 'object' ? { then } : Object.assign(() => {}, { then });

      expect(() => readResult(result)).toThrow('Schema validation must be synchronous');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(then).toHaveBeenCalledTimes(1);
      expect(storage.getItem('count')).toBe(42);
    },
  );

  it('accepts synchronous results with a non-callable then property', () => {
    // oxlint-disable-next-line unicorn/no-thenable -- Non-callable metadata must not make a result async.
    expect(readResult({ value: 42, issues: undefined, then: undefined })).toBe(42);
  });

  it.each([null, undefined])('propagates errors for a malformed %s schema result', (result) => {
    expect(() => readResult(result)).toThrow(TypeError);
    expect(storage.getItem('count')).toBe(42);
  });
});
