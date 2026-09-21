// @vitest-environment node
import { matchRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentRequest, handlerFixture } from '@__helpers__/request-handler';
import SsrPolicy from '@core/ssr-policy';

vi.mock('react-router', { spy: true });
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('Fetch request guard integration', () => {
  it('rejects before onRequest, getHtml, policy and loaders', async () => {
    const onRequest = vi.fn();
    const decide = vi.fn(() => 'ssr' as const);
    const fixture = handlerFixture({ onRequest, ssr: { decide } });
    for (const [path, method, status] of [
      ['/', 'DELETE', 405],
      ['/%GG', 'GET', 400],
      ['/x.php', 'GET', 404],
      ['/missing.xml', 'GET', 404],
    ] as const) {
      const response = await fixture.fetch(documentRequest(path, { method }));
      expect(response.status).toBe(status);
      await response.text();
    }
    expect(onRequest).not.toHaveBeenCalled();
    expect(fixture.getHtml).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.renderToStream).not.toHaveBeenCalled();
  });

  it('shares a single match result with SsrPolicy and SPA preparation', async () => {
    const select = vi.spyOn(SsrPolicy.prototype, 'select');
    const prepare = vi.fn();
    const fixture = handlerFixture({ ssr: { mode: 'include', routes: [] }, prepare });
    vi.mocked(matchRoutes).mockClear();
    const response = await fixture.fetch(documentRequest());
    expect(response.status).toBe(200);
    expect(vi.mocked(matchRoutes)).toHaveBeenCalledTimes(1);
    const matches = vi.mocked(matchRoutes).mock.results[0].value;
    expect(select.mock.calls[0][2]).toBe(matches);
    expect(prepare.mock.calls[0][0].context.matches).toBe(matches);
    expect(fixture.query).not.toHaveBeenCalled();
    await response.text();
    select.mockRestore();
  });

  it('passes POST actions and mounted resource routes to the router', async () => {
    const action = vi.fn(() => null);
    const fixture = handlerFixture({}, [
      { path: '/action', action },
      { path: '/sitemap.xml' },
      { path: '/.well-known/security.txt' },
    ]);
    for (const [path, method] of [
      ['/action', 'POST'],
      ['/sitemap.xml', 'GET'],
      ['/.well-known/security.txt', 'GET'],
    ]) {
      const response = await fixture.fetch(documentRequest(path, { method }));
      expect(response.status).toBe(200);
      await response.text();
    }
    expect(action).toHaveBeenCalledOnce();
  });

  it('disables all guard/notFound behavior with requestGuard false', async () => {
    const onRequest = vi.fn(() => new Response('api', { status: 201 }));
    const fixture = handlerFixture({
      requestGuard: false,
      notFound: new Response('404'),
      onRequest,
    });
    const response = await fixture.fetch(documentRequest('/x.php', { method: 'DELETE' }));
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('api');
    expect(onRequest).toHaveBeenCalledOnce();
  });
});

describe('notFound modes', () => {
  it('renders by default and marks a router 404 private', async () => {
    const fixture = handlerFixture();
    const response = await fixture.fetch(documentRequest('/missing'));
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toContain('RENDERED');
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
  });

  it('returns a 404 SPA shell for humans and renders bots with the default bot policy', async () => {
    const fixture = handlerFixture({ notFound: 'spa' });
    const human = await fixture.fetch(documentRequest('/missing'));
    expect(human.status).toBe(404);
    expect(human.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await human.text()).toContain('data-force-spa');
    expect(fixture.query).not.toHaveBeenCalled();
    expect(fixture.renderToStream).not.toHaveBeenCalled();
    const bot = await fixture.fetch(
      documentRequest('/missing', { headers: { 'User-Agent': 'Googlebot' } }),
    );
    expect(bot.status).toBe(404);
    expect(await bot.text()).toContain('RENDERED');
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
  });

  it('honors bots policy and decide notFound even on a mounted route', async () => {
    const fixture = handlerFixture({
      notFound: 'spa',
      ssr: { bots: 'policy' },
      requestGuard: { decide: async () => 'notFound' as const },
    });
    const response = await fixture.fetch(
      documentRequest('/', { headers: { 'User-Agent': 'Googlebot' } }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('data-force-spa');
    expect(fixture.query).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'clones custom Response%s per request, with HEAD and header rules',
    async (isFunction) => {
      const shared = new Response('custom 404', {
        status: 200,
        headers: { 'Cache-Control': 'public' },
      });
      const custom = vi.fn(async () => shared);
      const fixture = handlerFixture({ notFound: isFunction ? custom : shared });
      for (const method of ['GET', 'GET', 'HEAD']) {
        const response = await fixture.fetch(documentRequest('/missing', { method }));
        expect(response.status).toBe(404);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(await response.text()).toBe(method === 'HEAD' ? '' : 'custom 404');
      }
      expect(shared.bodyUsed).toBe(false);
      expect(fixture.getHtml).not.toHaveBeenCalled();
      const override = handlerFixture({
        notFound: shared,
        documentHeaders: [{ when: () => true, set: { 'Cache-Control': 'public, max-age=10' } }],
      });
      expect((await override.fetch(documentRequest('/missing'))).headers.get('Cache-Control')).toBe(
        'public, max-age=10',
      );
    },
  );

  it.each(['render', 'spa', 'cached'] as const)(
    'applies document header rules to %s 404s',
    async (notFound) => {
      const fixture = handlerFixture({
        notFound,
        documentHeaders: [{ when: () => true, set: { 'Cache-Control': 'public, max-age=10' } }],
      });
      const response = await fixture.fetch(documentRequest('/missing'));
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=10');
      await response.text();
    },
  );
});

describe('runtime cached 404s', () => {
  it('strips credentials before initialization, HTML, preparation and render, then skips hooks on hits', async () => {
    const onRequest = vi.fn(({ request }: { request: Request }) => {
      expect(request.headers.has('Cookie')).toBe(false);
      expect(request.headers.has('Authorization')).toBe(false);
      return { appProps: { anonymous: true } };
    });
    const prepare = vi.fn(({ context }) => {
      expect(context.request.headers.has('Cookie')).toBe(false);
      expect(context.request.headers.has('Authorization')).toBe(false);
    });
    const onShellReady = vi.fn(({ context }) => {
      expect(context.isStream).toBe(false);
      return {};
    });
    const getHtml = vi.fn((request: Request) => {
      expect(request.headers.has('Cookie')).toBe(false);
      expect(request.headers.has('Authorization')).toBe(false);
      return { header: '<html><div id="root">', footer: '</div></html>' };
    });
    const fixture = handlerFixture({
      notFound: 'cached',
      onRequest,
      prepare,
      onShellReady,
      getHtml,
    });
    const first = await fixture.fetch(
      documentRequest('/missing', {
        headers: { Cookie: 'session=secret', Authorization: 'Bearer secret' },
      }),
    );
    const html = await first.text();
    const next = await fixture.fetch(documentRequest('/different-missing'));
    expect(next.status).toBe(404);
    expect(await next.text()).toBe(html);
    expect(onRequest).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(getHtml).toHaveBeenCalledOnce();
    expect(onShellReady).toHaveBeenCalledOnce();
    expect(fixture.query).toHaveBeenCalledOnce();
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
  });

  it('never replays a cookie issued during the anonymous render', async () => {
    const fixture = handlerFixture({
      notFound: 'cached',
      onRequest: () => ({ headers: { 'Set-Cookie': 'visitor=1', 'X-App': 'kept' } }),
    });

    for (const path of ['/first', '/second']) {
      const response = await fixture.fetch(documentRequest(path));

      expect(response.status).toBe(404);
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect(response.headers.get('X-App')).toBe('kept');
      await response.text();
    }
  });

  it('applies header rules per consumer without caching cookie- or URL-dependent headers', async () => {
    const fixture = handlerFixture({
      notFound: 'cached',
      sessionCookie: 'session',
      documentHeaders: [
        {
          when: ({ routerContext }) => routerContext?.statusCode === 404,
          set: { 'Cache-Control': 'public, max-age=10' },
        },
        { when: ({ url }) => url.pathname === '/second', set: { 'X-Path': 'second' } },
      ],
    });
    const guest = await fixture.fetch(documentRequest('/first'));
    expect(guest.headers.get('Cache-Control')).toBe('public, max-age=10');
    await guest.text();
    const privateResponse = await fixture.fetch(
      documentRequest('/second', { headers: { Cookie: 'session=secret' } }),
    );
    expect(privateResponse.headers.get('Cache-Control')).toBe('private, no-store');
    expect(privateResponse.headers.get('X-Path')).toBe('second');
    await privateResponse.text();
    const next = await fixture.fetch(documentRequest('/third'));
    expect(next.headers.has('X-Path')).toBe(false);
    expect(next.headers.get('Cache-Control')).toBe('public, max-age=10');
    await next.text();
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
  });

  it('does not cache failures while reading transformed HTML or a bodyless bypass', async () => {
    const fixture = handlerFixture({
      notFound: 'cached',
      onResponse: () => {
        throw new Error('body read');
      },
    });
    for (let index = 0; index < 2; index += 1) {
      await expect(fixture.fetch(documentRequest('/missing'))).rejects.toThrow('body read');
    }
    expect(fixture.renderToStream).toHaveBeenCalledTimes(2);
    const onRequest = vi.fn(() => new Response(null, { status: 204 }));
    const bypass = handlerFixture({ notFound: 'cached', onRequest });
    for (let index = 0; index < 2; index += 1) {
      const response = await bypass.fetch(documentRequest('/missing'));
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    }
    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it('partitions keys and evicts least recently used entries', async () => {
    const onRequest = vi.fn();
    const fixture = handlerFixture({
      notFound: { mode: 'cached', maxEntries: 2, key: (request) => new URL(request.url).pathname },
      onRequest,
    });
    for (const path of ['/a', '/b', '/a', '/c', '/a', '/b']) {
      await (await fixture.fetch(documentRequest(path))).text();
    }
    expect(onRequest.mock.calls.map(([{ request }]) => new URL(request.url).pathname)).toEqual([
      '/a',
      '/b',
      '/c',
      '/b',
    ]);
  });

  it('deduplicates concurrent first requests and buffers before serving either response', async () => {
    let resolve!: () => void;
    const ready = new Promise<void>((done) => {
      resolve = done;
    });
    const onRequest = vi.fn(async () => {
      await ready;
      return {};
    });
    const fixture = handlerFixture({ notFound: 'cached', onRequest });
    const first = fixture.fetch(documentRequest('/a'));
    const second = fixture.fetch(documentRequest('/b'));
    await vi.waitFor(() => expect(onRequest).toHaveBeenCalledOnce());
    resolve();
    const responses = await Promise.all([first, second]);
    expect(await responses[0].text()).toBe(await responses[1].text());
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
  });

  it('warms full HTML on HEAD and serves HEAD hits bodyless', async () => {
    const fixture = handlerFixture({ notFound: 'cached' });
    const first = await fixture.fetch(documentRequest('/missing', { method: 'HEAD' }));
    expect(first.body).toBeNull();
    expect(first.status).toBe(404);
    expect(await (await fixture.fetch(documentRequest('/missing'))).text()).toContain('RENDERED');
    const next = await fixture.fetch(documentRequest('/missing', { method: 'HEAD' }));
    expect(next.body).toBeNull();
    expect(fixture.renderToStream).toHaveBeenCalledOnce();
  });

  it('does not retain non-404 router renders or onRequest bypasses', async () => {
    const fixture = handlerFixture({
      notFound: 'cached',
      requestGuard: { decide: () => 'notFound' },
    });
    for (let index = 0; index < 2; index += 1) {
      await (await fixture.fetch(documentRequest())).text();
    }
    expect(fixture.renderToStream).toHaveBeenCalledTimes(2);
    const onRequest = vi.fn(() => new Response('bypass', { status: 201 }));
    const bypass = handlerFixture({ notFound: 'cached', onRequest });
    await (await bypass.fetch(documentRequest('/a'))).text();
    await (await bypass.fetch(documentRequest('/a'))).text();
    expect(onRequest).toHaveBeenCalledTimes(2);
  });

  it('evicts failed in-flight work and does not cache thrown or failed renders', async () => {
    const onRequest = vi.fn(() => {
      throw new Error('init');
    });
    const fixture = handlerFixture({ notFound: 'cached', onRequest });
    for (let index = 0; index < 2; index += 1) {
      await expect(fixture.fetch(documentRequest('/missing'))).rejects.toThrow('init');
    }
    expect(onRequest).toHaveBeenCalledTimes(2);
    const broken = handlerFixture({ notFound: 'cached' });
    broken.renderToStream.mockImplementation(() => {
      throw new Error('render');
    });
    for (let index = 0; index < 2; index += 1) {
      const response = await broken.fetch(documentRequest('/missing'));
      expect(response.status).toBe(500);
      await response.text();
    }
    expect(broken.renderToStream).toHaveBeenCalledTimes(2);
  });

  it('falls back to ordinary credentialed rendering whenever nonce is configured', async () => {
    const onRequest = vi.fn(({ request }: { request: Request }) => {
      expect(request.headers.get('Cookie')).toBe('session=original');
      return {};
    });
    const fixture = handlerFixture({ notFound: 'cached', nonce: 'unique', onRequest });
    for (let index = 0; index < 2; index += 1) {
      await (
        await fixture.fetch(
          documentRequest('/missing', { headers: { Cookie: 'session=original' } }),
        )
      ).text();
    }
    expect(fixture.renderToStream).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenCalledTimes(2);
  });
});
