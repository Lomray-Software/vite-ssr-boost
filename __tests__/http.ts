// @vitest-environment node
import { createStaticHandler } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { cacheControl, conditionalRequest, copyLoaderHeaders, documentHeaders } from '../src/http';
import Diagnostics from '@services/diagnostics';

const publicRules = [{ when: () => true, set: { 'Cache-Control': 'public, s-maxage=30' } }];
const context = (requestHeaders: HeadersInit = {}, headers: HeadersInit = {}) => ({
  request: new Request('https://example.test/guest', { headers: requestHeaders }),
  response: { headers: new Headers(headers) },
});

describe('cacheControl', () => {
  it.each([
    [{}, ''],
    [{ public: true, maxAge: 0, sMaxAge: 30 }, 'public, max-age=0, s-maxage=30'],
    [{ private: true, noStore: true }, 'private, no-store'],
    [
      { maxAge: 30, staleWhileRevalidate: 60, staleIfError: 120 },
      'max-age=30, stale-while-revalidate=60, stale-if-error=120',
    ],
    [{ noCache: true, mustRevalidate: true }, 'no-cache, must-revalidate'],
    [{ immutable: true, maxAge: 100, public: false }, 'max-age=100, immutable'],
    [{ maxAge: undefined, noStore: false }, ''],
  ])('serializes %j', (policy, value) => expect(cacheControl(policy)).toBe(value));

  it.each([
    null,
    [],
    'public',
    { typo: true },
    { public: 'yes' },
    { noStore: 1 },
    { maxAge: -1 },
    { sMaxAge: 1.5 },
    { staleWhileRevalidate: NaN },
    { staleIfError: Infinity },
    { maxAge: Number.MAX_SAFE_INTEGER + 1 },
    { maxAge: '30' },
    { public: true, private: true },
    { noStore: true, public: true },
    { noStore: true, maxAge: 0 },
    { noStore: true, immutable: true },
    { private: true, sMaxAge: 30 },
    { noCache: true, immutable: true },
    { mustRevalidate: true, staleWhileRevalidate: 30 },
    { noCache: true, staleIfError: 30 },
  ])('rejects %j', (policy) => expect(() => cacheControl(policy as never)).toThrow(TypeError));
});

describe('documentHeaders', () => {
  it.each([
    [{}, {}, 'public, s-maxage=30'],
    [{ Cookie: 'theme=dark; session=secret' }, {}, 'private, no-store'],
    [{ Cookie: 'session=' }, {}, 'private, no-store'],
    [{ Cookie: 'session=0' }, {}, 'private, no-store'],
    [{ Authorization: '' }, {}, 'private, no-store'],
    [{}, { 'Set-Cookie': 'session=new' }, 'private, no-store'],
    [{ Cookie: 'other_session=x; Session=x; theme=session=x' }, {}, 'public, s-maxage=30'],
  ])('protects request %j and response %j', (request, response, expected) => {
    const input = context(request, response);
    const result = documentHeaders(publicRules, { sessionCookie: 'session' })(input);
    expect(result.get('Cache-Control')).toBe(expected);
    expect(input.response.headers.has('Cache-Control')).toBe(false);
  });

  it('applies matching rules in order and appends every cookie before privacy protection', () => {
    const check = vi.fn(({ url, isBot, hasCookie, request, routerContext }) => {
      expect(url.pathname).toBe('/guest');
      expect(isBot).toBe(true);
      expect(hasCookie('session')).toBe(true);
      expect(request).toBe(input.request);
      expect(routerContext).toBeUndefined();
      return true;
    });
    const input = context(
      { Cookie: 'session=;', 'User-Agent': 'Googlebot' },
      { 'X-Rule': 'initial' },
    );
    const rules: Parameters<typeof documentHeaders>[0] = [
      { when: check, set: { 'X-Rule': 'first', 'Set-Cookie': 'a=1' } },
      { when: () => false, set: { 'X-Rule': 'skipped' } },
      {
        when: () => true,
        set: [
          ['X-Rule', 'last'],
          ['Set-Cookie', 'b=2'],
          ['Set-Cookie', 'c=3'],
        ] as [string, string][],
      },
    ];
    const result = documentHeaders(rules)(input);
    expect(result.get('X-Rule')).toBe('last');
    expect(result.getSetCookie()).toEqual(['a=1', 'b=2', 'c=3']);
    expect(result.get('Cache-Control')).toBe('private, no-store');
  });

  it.each(['Cookie', 'Accept-Encoding, cOoKiE', '* , Cookie'])(
    'never emits Cookie in Vary (%s)',
    (vary) => {
      const result = documentHeaders([{ when: () => true, set: { Vary: vary } }])(context());
      expect(result.get('Vary')).toBe(
        vary === 'Cookie' ? null : vary.startsWith('*') ? '*' : 'Accept-Encoding',
      );
    },
  );

  it('supports explicit overrides and leaves guests without matching policy unchanged', () => {
    expect(documentHeaders([], { sessionCookie: 'session' })(context()).has('Cache-Control')).toBe(
      false,
    );
    expect(
      documentHeaders(publicRules, { sessionCookie: 'session', protectPrivate: false })(
        context({ Cookie: 'session=x' }),
      ).get('Cache-Control'),
    ).toBe('public, s-maxage=30');
  });
});

describe('copyLoaderHeaders', () => {
  it('uses route depth, loader before action, appends cookies and excludes Content-Type', async () => {
    const router = await createStaticHandler([
      { id: 'root', path: '/', children: [{ id: 'leaf', path: 'guest', loader: () => null }] },
    ]).query(new Request('https://example.test/guest'));
    if (router instanceof Response) throw new Error('Expected a router context');
    router.loaderHeaders = {
      leaf: new Headers({
        'Cache-Control': 'public',
        'X-Depth': 'leaf',
        'Set-Cookie': 'leaf=1',
        'Content-Type': 'application/json',
      }),
      root: new Headers({
        'Cache-Control': 'private',
        'Set-Cookie': 'root=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      }),
      unmatched: new Headers({ 'Set-Cookie': 'ignored=1' }),
    };
    router.actionHeaders = {
      root: new Headers({
        'Cache-Control': 'no-store',
        'X-Depth': 'root-action',
        'Set-Cookie': 'action=1',
      }),
    };
    const headers = copyLoaderHeaders(router, {
      allow: ['cache-control', 'SET-COOKIE', 'Content-Type', 'X-Depth'],
    });
    expect(headers.get('Cache-Control')).toBe('private');
    expect(headers.get('X-Depth')).toBe('root-action');
    expect(headers.get('Content-Type')).toBeNull();
    expect(headers.getSetCookie()).toEqual([
      'root=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      'action=1',
      'leaf=1',
    ]);
    expect([...copyLoaderHeaders(router, { allow: [] })]).toEqual([]);
    expect(router.loaderHeaders.leaf.get('Cache-Control')).toBe('public');
  });
});

describe('conditionalRequest', () => {
  const validators = { etag: '"version,1"', lastModified: new Date('2026-09-01T12:00:00.900Z') };
  it.each(['GET', 'HEAD'])('weakly matches ETag lists for %s without a body', async (method) => {
    const response = conditionalRequest(
      new Request('https://example.test/', {
        method,
        headers: { 'If-None-Match': '"other", W/"version,1"' },
      }),
      validators,
    )!;
    expect(response.status).toBe(304);
    expect(response.headers.get('ETag')).toBe(validators.etag);
    expect(response.headers.get('Last-Modified')).toBe('Tue, 01 Sep 2026 12:00:00 GMT');
    expect(await response.text()).toBe('');
  });
  it.each([
    [{ 'If-None-Match': '*' }, 304],
    [{ 'If-None-Match': '"miss"' }, undefined],
    [{ 'If-None-Match': 'bad "version,1"' }, undefined],
    [
      { 'If-None-Match': '"miss"', 'If-Modified-Since': 'Tue, 01 Sep 2026 12:00:00 GMT' },
      undefined,
    ],
    [{ 'If-Modified-Since': 'Tue, 01 Sep 2026 12:00:00 GMT' }, 304],
    [{ 'If-Modified-Since': 'Wed, 02 Sep 2026 12:00:00 GMT' }, 304],
    [{ 'If-Modified-Since': 'Mon, 31 Aug 2026 12:00:00 GMT' }, undefined],
    [{ 'If-Modified-Since': 'invalid' }, undefined],
    [{ 'If-Modified-Since': '2099' }, undefined],
    [{ 'If-Modified-Since': '2099-09-01T12:00:00Z' }, undefined],
    [{}, undefined],
  ])('evaluates %j', (headers, status) => {
    expect(
      conditionalRequest(new Request('https://example.test/', { headers }), validators)?.status,
    ).toBe(status);
  });
  it('ignores unsafe methods and never falls back to dates when an ETag condition is present', () => {
    expect(
      conditionalRequest(
        new Request('https://example.test/', { method: 'POST', headers: { 'If-None-Match': '*' } }),
        validators,
      ),
    ).toBeUndefined();
    expect(
      conditionalRequest(
        new Request('https://example.test/', {
          headers: { 'If-None-Match': '"x"', 'If-Modified-Since': 'Tue, 01 Sep 2026 12:00:00 GMT' },
        }),
        { lastModified: validators.lastModified },
      ),
    ).toBeUndefined();
  });
  it.each([{ etag: 'unquoted' }, { etag: '"bad\n"' }, { lastModified: 'bad' }])(
    'validates %j',
    (value) => {
      expect(() => conditionalRequest(new Request('https://example.test/'), value)).toThrow(
        TypeError,
      );
    },
  );
});

describe('cache private leak diagnostic', () => {
  it('warns once without revealing cookie or authorization values', () => {
    const logger = { warn: vi.fn() };
    const diagnostics = new Diagnostics('/private-leak-test', logger);
    const headers = new Headers({
      'Cache-Control': 'PUBLIC, max-age=30',
      'Set-Cookie': 'secret=do-not-log',
    });
    diagnostics.inspectCachePolicy(headers, false);
    diagnostics.inspectCachePolicy(headers, true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('SSR_BOOST_CACHE_PRIVATE_LEAK');
    expect(logger.warn.mock.calls[0][0]).not.toContain('do-not-log');
    diagnostics.inspectCachePolicy(new Headers({ 'Cache-Control': 'private, no-store' }), true);
    diagnostics.inspectCachePolicy(new Headers({ 'Cache-Control': 'public' }), false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    new Diagnostics('/cookie-only-leak', logger).inspectCachePolicy(
      new Headers({ 'Cache-Control': 'public' }),
      true,
    );
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
