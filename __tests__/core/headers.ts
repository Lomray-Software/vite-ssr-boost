import { describe, expect, it } from 'vitest';
import { getHeaderEntries, getSetCookieHeaders, mergeResponseHeaders } from '@core/headers';

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

  it('merges immutable redirect headers without mutating either source', () => {
    const redirect = Response.redirect('https://example.com/next');
    const base = new Headers({ Location: '/old', 'Set-Cookie': 'session=1', 'X-Hook': 'yes' });
    const response = mergeResponseHeaders(redirect, base);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://example.com/next');
    expect(response.headers.getSetCookie()).toEqual(['session=1']);
    expect(redirect.headers.get('X-Hook')).toBeNull();
    expect(base.get('Location')).toBe('/old');
  });
});
