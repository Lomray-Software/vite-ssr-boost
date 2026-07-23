import { describe, expect, it } from 'vitest';
import { getHeaderEntries, getSetCookieHeaders } from '@core/headers';

describe('core headers', () => {
  it('keeps Set-Cookie values separate', () => {
    const headers = new Headers({ 'Content-Type': 'text/html' });

    headers.append('Set-Cookie', 'session=one; Path=/; HttpOnly');
    headers.append('Set-Cookie', 'expires=two; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

    expect(getSetCookieHeaders(headers)).toEqual([
      'session=one; Path=/; HttpOnly',
      'expires=two; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    expect(getHeaderEntries(headers)).toEqual([['content-type', 'text/html']]);
  });
});
