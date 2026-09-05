import { describe, expect, it } from 'vitest';
import serializeBody from '@adapters/body';

describe('adapter body serialization', () => {
  it('serializes parsed JSON and form bodies deliberately', () => {
    expect(serializeBody({ value: 1 }, 'application/json')).toBe('{"value":1}');
    expect(
      serializeBody({ one: '1', two: ['a', 'b'] }, 'application/x-www-form-urlencoded')?.toString(),
    ).toBe('one=1&two=a&two=b');
  });

  it('preserves standard BodyInit values', () => {
    const body = new Uint8Array([1, 2, 3]);

    expect(serializeBody(body, 'application/octet-stream')).toBe(body);
  });

  it('requires an explicit seam for parsed multipart or custom bodies', () => {
    expect(() => serializeBody({ field: 'value' }, 'multipart/form-data')).toThrow(
      'Provide the adapter getBody option',
    );
  });

  it.each([{ user: { name: 'Alice' } }, { users: [{ name: 'Alice' }] }, { list: [['nested']] }])(
    'rejects nested URL-encoded values rather than silently corrupting them',
    (body) => {
      expect(() => serializeBody(body, 'application/x-www-form-urlencoded')).toThrow(
        'Provide the adapter getBody option',
      );
    },
  );
});
