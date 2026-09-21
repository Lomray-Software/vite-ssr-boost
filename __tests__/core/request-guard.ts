// @vitest-environment node
import { createStaticHandler } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import RequestGuard from '@core/request-guard';
import requestTargets from '@core/request-target';
import createRequest from '@node/create-request';

const routes = createStaticHandler([
  {
    path: '/:lang?',
    children: [
      { index: true },
      ...[
        'login',
        'search/:tag?',
        'characters/:characterId',
        'profiles/:profileId',
        'scripts',
        'scripts/new',
        'scripts/:scriptId',
        'scripts/:scriptId/edit',
        'chats/:chatId',
        'chats/:chatId/publish',
        'chats/public/:chatId',
        'plus/return/:reason',
        'plus/router/topup/success',
        'account/subscription/:reason',
        'embedded/render-markdown',
        'media-library-modal',
        'term',
        'sitemap.xml',
        '.well-known/security.txt',
      ].map((path) => ({ path })),
    ],
  },
]).dataRoutes;
const request = (path: string, method = 'GET') =>
  new Request(`https://example.test${path}`, { method });

/** Preserve an unnormalized target just as the Node transport does. */
const rawRequest = (path: string) => {
  const input = request(path);
  requestTargets.set(input, path);
  return input;
};

describe('RequestGuard (ported reference checks)', () => {
  const guard = new RequestGuard(routes);

  it.each([
    '/',
    '/de',
    '/login',
    '/de/login',
    '/search',
    '/search/male',
    '/characters/123_slug',
    '/profiles/123_profile',
    '/scripts/new',
    '/scripts/123',
    '/scripts/123/edit',
    '/chats/123',
    '/chats/123/publish',
    '/chats/public/chat-slug',
    '/plus/return/success',
    '/plus/router/topup/success',
    '/account/subscription/cancel',
    '/embedded/render-markdown',
    '/media-library-modal',
    '/term',
    '/login/',
    '/login?from=%2Fplus',
    '/sitemap.xml',
    '/.well-known/security.txt',
  ])('allows mounted route %s', async (path) => {
    const result = await guard.handle(request(path));
    expect(result.response).toBeUndefined();
    expect(result.notFound).toBeUndefined();
    expect(result.matches.length).toBeGreaterThan(0);
  });

  it.each([
    '/random.php',
    '/RANDOM.PHTML',
    '/characters/random.jsp',
    '/profiles/random.aspx/',
    '/.env',
    '/.git/config',
    '/profiles/.env',
    '/random.php7',
    '/random.phar',
    '/random.cgi',
    '/random.cfml',
  ])('rejects scanner probe %s before matching', async (path) => {
    expect(await guard.handle(request(path))).toMatchObject({
      reason: 'blocked-extension',
      response: { status: 404 },
      matches: [],
    });
  });

  it.each([
    '/foo//bar',
    '/foo/../bar',
    '/foo/./bar',
    '/foo/%2e%2e/bar',
    '/foo\\bar',
    '/foo/%5cbar',
    '/%GG',
    '/%E0%A4%A',
    '/foo/%00bar',
    '/foo/%7fbar',
    '/foo/\tbar',
  ])('rejects malformed raw target %s', async (path) => {
    expect(await guard.handle(rawRequest(path))).toMatchObject({
      reason: 'malformed-target',
      response: { status: 400 },
    });
  });

  it('checks raw request.url before parsing a non-normalized Fetch-native URL', async () => {
    const input = request('/');
    Object.defineProperty(input, 'url', { value: 'https://example.test/foo/../bar' });
    expect((await guard.handle(input)).response?.status).toBe(400);
  });

  it('preserves raw Node targets before WHATWG normalization', async () => {
    const input = createRequest({
      url: '/foo/../login',
      method: 'GET',
      headers: { host: 'example.test' },
    } as never);
    expect(new URL(input.url).pathname).toBe('/login');
    expect((await guard.handle(input)).response?.status).toBe(400);
  });

  it.each(['PUT', 'DELETE', 'PATCH', 'OPTIONS'])(
    'rejects %s first with Allow and no-store',
    async (method) => {
      const onReject = vi.fn();
      const input = request('/%GG', method);
      const { response } = await new RequestGuard(routes, { onReject }).handle(input);
      expect(response?.status).toBe(405);
      expect(await response?.text()).toBe('Method Not Allowed');
      expect(response?.headers.get('Allow')).toBe('GET, HEAD, POST');
      expect(response?.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
      expect(onReject).toHaveBeenCalledExactlyOnceWith({
        request: input,
        reason: 'method',
        status: 405,
      });
    },
  );

  it('allows POST and HEAD through to actions/rendering and supports custom methods', async () => {
    expect((await guard.handle(request('/login', 'POST'))).response).toBeUndefined();
    expect((await guard.handle(request('/login', 'HEAD'))).response).toBeUndefined();
    expect(
      (
        await new RequestGuard(routes, { methods: ['OPTIONS'] }).handle(
          request('/login', 'OPTIONS'),
        )
      ).response,
    ).toBeUndefined();
    const { response } = await guard.handle(request('/random.php', 'HEAD'));
    expect(response?.status).toBe(404);
    expect(response?.body).toBeNull();
  });

  it.each([
    [`/login/${'a'.repeat(2048)}`, 'target-too-large', 414],
    [`/login?x=${'a'.repeat(6144)}`, 'target-too-large', 414],
    [`/${'a'.repeat(2000)}?${'b'.repeat(6200)}`, 'target-too-large', 414],
    [`/characters/${'a'.repeat(1025)}`, 'malformed-target', 400],
    [`/${Array(33).fill('a').join('/')}`, 'malformed-target', 400],
  ])('enforces default target/path/segment/depth bounds: %s', async (path, reason, status) => {
    expect(await guard.handle(request(path))).toMatchObject({ reason, response: { status } });
  });

  it('ports strict reference depth/segment limits and counts UTF-8 bytes', async () => {
    const strict = new RequestGuard(routes, { maxSegments: 8, maxSegmentBytes: 512 });
    expect((await strict.handle(request(`/characters/${'a'.repeat(513)}`))).response?.status).toBe(
      400,
    );
    expect((await strict.handle(request('/a/b/c/d/e/f/g/h/i'))).response?.status).toBe(400);
    const input = request('/');
    Object.defineProperty(input, 'url', {
      value: `https://example.test/characters/${'é'.repeat(257)}`,
    });
    expect((await strict.handle(input)).response?.status).toBe(400);
  });

  it('allows %2F by default and rejects encoded and double-encoded delimiters in strict mode', async () => {
    expect((await guard.handle(request('/characters/one%2Ftwo'))).response).toBeUndefined();
    const strict = new RequestGuard(routes, { encodedDelimiters: 'reject' });
    for (const delimiter of ['%2F', '%5c', '%23', '%3f', '%252f', '%255c', '%2523', '%253f']) {
      expect(
        (await strict.handle(request(`/characters/one${delimiter}two`))).response?.status,
      ).toBe(400);
    }
  });

  it('lets apps supply the reference locale restriction via decide', async () => {
    const localized = new RequestGuard(routes, {
      decide: ({ matches }) => {
        const language = matches[0]?.params.lang;
        return language && language !== 'de' ? 'notFound' : undefined;
      },
    });
    for (const path of [
      '/garbage',
      '/en/login',
      '/EN/login',
      '/xx/login',
      '/blocks',
      '/following',
    ]) {
      expect((await localized.handle(request(path))).notFound).toBe(true);
    }
    expect((await localized.handle(request('/de/login'))).notFound).toBeUndefined();
    expect((await localized.handle(request('/de/en/login'))).notFound).toBe(true);
  });

  it('keeps matched asset resources and rejects unmatched file-like paths', async () => {
    expect((await guard.handle(request('/characters/random.js'))).response).toBeUndefined();
    expect((await guard.handle(request('/profiles/random.webp'))).response).toBeUndefined();
    const simple = new RequestGuard(createStaticHandler([{ path: '/' }]).dataRoutes);
    expect(await simple.handle(request('/missing.xml'))).toMatchObject({
      reason: 'route',
      response: { status: 404 },
    });
    expect(await simple.handle(request('/missing'))).toMatchObject({
      notFound: true,
      reason: 'route',
    });
  });

  it('supports extension arrays, disabled checks, cloned stateful regex and well-known dotfile exemption', async () => {
    const pattern = /\.js$/gi;
    pattern.lastIndex = 99;
    const custom = new RequestGuard(routes, { blockedExtensions: pattern });
    for (let index = 0; index < 2; index += 1) {
      expect((await custom.handle(request('/characters/random.js'))).response?.status).toBe(404);
    }
    expect(pattern.lastIndex).toBe(99);
    expect(
      (
        await new RequestGuard(routes, { blockedExtensions: ['js', 'webp'] }).handle(
          request('/profiles/random.WEBP/'),
        )
      ).response?.status,
    ).toBe(404);
    expect(
      (
        await new RequestGuard(routes, { blockedExtensions: false }).handle(
          request('/characters/random.php'),
        )
      ).response,
    ).toBeUndefined();
    expect(
      (await new RequestGuard(routes, { blockDotfiles: false }).handle(request('/characters/.env')))
        .response,
    ).toBeUndefined();
    expect((await guard.handle(request('/.well-known/.private'))).reason).not.toBe(
      'blocked-extension',
    );
  });

  it('honors basename and passes one shared match result to async decide', async () => {
    const decide = vi.fn(async () => 'allow' as const);
    const input = request('/app/login');
    const mounted = new RequestGuard(routes, { decide }, '/app');
    const result = await mounted.handle(input);
    expect(result.response).toBeUndefined();
    expect(decide).toHaveBeenCalledWith({
      request: input,
      url: new URL(input.url),
      matches: result.matches,
    });
    expect((await mounted.handle(request('/login'))).notFound).toBe(true);
  });

  it('supports decide Responses and isolates a throwing rejection hook', async () => {
    const custom = new RequestGuard(routes, {
      decide: async () => new Response('custom', { status: 403 }),
      onReject: () => {
        throw new Error('metrics');
      },
    });
    const result = await custom.handle(request('/login'));
    expect(result.reason).toBe('decide');
    expect(await result.response?.text()).toBe('custom');
    expect((await custom.handle(request('/x.php'))).response?.status).toBe(404);
  });
});
