import { describe, expect, it } from 'vite-plus/test';
import { deserializeStorageKey, serializeStorageKey } from './keys';

describe('storage keys', () => {
  it('leaves string keys unchanged', () => {
    expect(serializeStorageKey('users:42')).toBe('users:42');
  });

  it('serializes string arrays without using their contents as delimiters', () => {
    expect(serializeStorageKey(['users', 'a:b', '', '"quoted"'])).toBe(
      '\u0000us:a:["users","a:b","","\\\"quoted\\\""]',
    );
    expect(serializeStorageKey(['users', 'a:b'])).not.toBe(serializeStorageKey(['users:a', 'b']));
  });

  it('rejects unsupported key shapes at runtime', () => {
    expect(() => serializeStorageKey({ key: 'value' } as never)).toThrow(
      'Storage keys must be strings or arrays of strings.',
    );
    expect(() => serializeStorageKey(['users', 42] as never)).toThrow(
      'Array storage keys can only contain strings.',
    );
  });

  it.each([[], ['users', 'a:b', '', '"quoted"', '\\', '\u0000', '你好']])(
    'restores array key segments: %j',
    (...segments: string[]) => {
      const encoded = serializeStorageKey(segments);
      const decoded = deserializeStorageKey(encoded);
      expect(decoded).toEqual(segments);
      expect(decoded).not.toBe(segments);
      expect(deserializeStorageKey(encoded)).not.toBe(decoded);
    },
  );

  it.each([
    '',
    'users:42',
    '["users","42"]',
    '\u0000us:a:',
    '\u0000us:a:not-json',
    '\u0000us:a:null',
    '\u0000us:a:{}',
    '\u0000us:a:[42]',
    '\u0000us:a:["users",null]',
    '\u0000us:a:[ "users" ]',
    '\u0000us:a:["\\u0061"]',
  ])('preserves string keys that are not canonical array encodings: %j', (key) => {
    expect(deserializeStorageKey(key)).toBe(key);
  });
});
