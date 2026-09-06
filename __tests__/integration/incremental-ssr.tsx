// @vitest-environment node
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { createStaticHandler, redirect, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import entry from '@adapters/express/entry';
import PrepareServer from '@adapters/express/prepare-server';
import createServer from '@adapters/express/server';
import createHandler from '@core/handler';
import type { ISsrPolicy } from '@core/ssr-policy';
import createSpaHtml from '@core/spa-html';
import { createRouteAssetPreparer, loadHtmlShell } from '@node/production';
import renderToStream from '@node/render-to-stream';
import ServerConfig from '@services/server-config';

const human =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const html =
  '<!doctype html><html><head><title>App shell</title></head><body><div id="root"><!--ssr-outlet--></div><script type="module" src="/entry.js"></script></body></html>';
const App = ({ children }: React.PropsWithChildren) => <main>{children}</main>;
let directory: string;
const servers: Server[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ssr-boost-policy-'));
  await mkdir(join(directory, 'client'));
  await mkdir(join(directory, 'server'));
  await writeFile(join(directory, 'client/index.html'), html);
  await writeFile(
    join(directory, 'server/assets-manifest.json'),
    JSON.stringify({
      private: [
        { type: 'script', url: '/assets/private.js', weight: 2, isPreload: true, isNested: false },
        { type: 'style', url: '/assets/private.css', weight: 1, isPreload: false, isNested: false },
      ],
      public: [
        { type: 'style', url: '/assets/public.css', weight: 1, isPreload: false, isNested: false },
      ],
    }),
  );
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(async () => rm(directory, { force: true, recursive: true }));

const fixture = async (runtime: 'Fetch' | 'Express', ssr: ISsrPolicy, basename = '/') => {
  const loader = vi.fn(
    ({ request }: { request: Request }) => request.headers.get('cookie') ?? 'no cookie',
  );
  const privateLoader = vi.fn(() => redirect('/public'));
  const lazy = vi.fn(async () => ({
    Component: () => <p>Private rendered</p>,
    loader: privateLoader,
  }));
  const onRouterReady = vi.fn(() => ({ isStream: false }));
  const getState = vi.fn(() => ({ privateState: { secret: 'not in SPA' } }));
  const onShellReady = vi.fn(() => ({}));
  const onResponse = vi.fn(() => undefined);
  const hooks = { onRouterReady, getState, onShellReady, onResponse };
  const routes = [
    { id: 'home', path: '/', Component: () => <p>Home SSR</p> },
    {
      id: 'public',
      path: '/public',
      loader,
      Component: () => <p>Public: {useLoaderData() as string}</p>,
    },
    { id: 'private', path: '/private', lazy },
    { id: 'auth', path: '/auth', loader: privateLoader },
  ];
  const getHtml = await loadHtmlShell({ indexFile: join(directory, 'client/index.html') });
  let origin = 'http://example.test';
  let send: (request: Request) => Promise<Response>;
  const onRequest = vi.fn();

  if (runtime === 'Fetch') {
    send = createHandler(
      {
        handler: createStaticHandler(routes, { basename }),
        createApp: (children) => <App>{children}</App>,
        renderToStream,
      },
      {
        ssr,
        basename,
        getHtml,
        ...hooks,
        diagnostics: true,
        prepare: createRouteAssetPreparer({ buildDir: directory }),
        onRequest: ({ request }) => {
          onRequest(request);
          if (new URL(request.url).pathname.endsWith('/auth')) {
            return redirect('/login', 302);
          }
          return { headers: { 'X-Request-Hook': 'ran', 'Set-Cookie': 'checked=1; Path=/' } };
        },
      },
    );
  } else {
    const config = ServerConfig.init({ isProd: true }, { root: directory, port: 0 });
    const prepared = entry<Record<string, never>>(App, routes, {
      ssr,
      routerOptions: { basename },
      middlewares: { compression: false, expressStatic: false },
      init: () => ({
        ...hooks,
        onRequest: (req, res) => {
          onRequest(req);
          if (req.originalUrl.endsWith('/auth')) {
            res.redirect(302, '/login');
            return {};
          }
          res.setHeader('X-Request-Hook', 'ran');
          res.setHeader('Set-Cookie', 'checked=1; Path=/');
          return {};
        },
      }),
    });
    // Only replace module loading; run the real managed middleware, HTML cache,
    // request bridge, route manifest, React renderer and HTTP response writer.
    const initialized = await prepared.init!({ config });
    vi.spyOn(PrepareServer.prototype, 'loadEntrypoint').mockResolvedValue({
      ...prepared,
      ...initialized,
    });
    const { run } = await createServer(config);
    const server = run({ isPrintInfo: false }) as Server;
    servers.push(server);
    if (!server.listening) await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    send = (request) => fetch(request, { redirect: 'manual' });
  }

  return {
    loader,
    privateLoader,
    lazy,
    onRequest,
    hooks,
    request: (path: string, init: RequestInit = {}) =>
      send(
        new Request(`${origin}${path}`, {
          ...init,
          headers: { 'User-Agent': human, ...init.headers },
        }),
      ),
  };
};

describe.each(['Fetch', 'Express'] as const)('%s incremental SSR', (runtime) => {
  it.each<ISsrPolicy>([
    { mode: 'include', routes: ['/', '/public'] },
    { mode: 'exclude', routes: ['/private'] },
    { decide: ({ url }) => (url.pathname === '/private' ? 'spa' : 'ssr') },
  ])('serves the SPA shell and route assets before loaders for %j', async (ssr) => {
    const app = await fixture(runtime, ssr);
    const spa = await app.request('/private?initial=1');
    const body = await spa.text();
    expect(spa.status).toBe(200);
    expect(spa.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(spa.headers.get('Cache-Control')).toBe('no-store');
    expect(spa.headers.get('X-Request-Hook')).toBe('ran');
    expect(spa.headers.get('Set-Cookie')).toContain('checked=1');
    expect(body).toContain('id="root" data-force-spa="1"');
    expect(body).toContain('<link rel="stylesheet" href="/assets/private.css">');
    expect(body).toContain(
      '<link rel="modulepreload" as="script" crossorigin href="/assets/private.js">',
    );
    expect(body).toContain('src="/entry.js"');
    expect(body).not.toMatch(/__staticRouterHydrationData|privateState|Private rendered|<main>/);
    expect(app.lazy).not.toHaveBeenCalled();
    expect(app.privateLoader).not.toHaveBeenCalled();
    expect(app.onRequest).toHaveBeenCalledOnce();
    for (const hook of Object.values(app.hooks)) expect(hook).not.toHaveBeenCalled();
    const withoutAssets = body.replace(/<link\b[^>]*>/g, '').replace(/\n/g, '');
    expect(withoutAssets).toBe(createSpaHtml(html).replace('<!--ssr-outlet-->', ''));

    const ssrResponse = await app.request('/public', { headers: { Cookie: 'session=known' } });
    const rendered = await ssrResponse.text();
    expect(ssrResponse.status).toBe(200);
    expect(rendered).toContain('session=known');
    expect(rendered).toContain('window.__staticRouterHydrationData');
    expect(rendered).not.toContain('data-force-spa');
    expect(rendered).not.toContain('/assets/private');
    expect(app.loader).toHaveBeenCalledOnce();

    const reload = await (await app.request('/private')).text();
    expect(reload).toBe(body);
    expect(reload.match(/\/assets\/private.css/g)).toHaveLength(1);
  });

  it('forces Googlebot to SSR even when decide requests SPA', async () => {
    const app = await fixture(runtime, { mode: 'include', routes: ['/'], decide: () => 'spa' });
    const response = await app.request('/public', { headers: { 'User-Agent': 'Googlebot' } });
    expect(await response.text()).toContain('window.__staticRouterHydrationData');
    expect(app.loader).toHaveBeenCalledOnce();
  });

  it('allows bots to follow policy explicitly', async () => {
    const app = await fixture(runtime, { mode: 'include', bots: 'policy' });
    const response = await app.request('/public', { headers: { 'User-Agent': 'Googlebot' } });
    expect(await response.text()).not.toContain('__staticRouterHydrationData');
    expect(app.loader).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])(
    'preserves onRequest auth redirects on SPA routes for %s',
    async (method) => {
      const app = await fixture(runtime, { mode: 'include', routes: ['/'] });
      const response = await app.request('/auth', { method });
      expect(response.status).toBe(302);
      expect(response.headers.get('Location')).toBe('/login');
      if (method === 'HEAD') expect(await response.text()).toBe('');
      else await response.text();
      expect(app.privateLoader).not.toHaveBeenCalled();
    },
  );

  it('returns bodyless HEAD with SPA metadata and no loaders', async () => {
    const app = await fixture(runtime, { mode: 'exclude', routes: ['/private'] });
    const response = await app.request('/private', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe('');
    expect(app.lazy).not.toHaveBeenCalled();
  });

  it('matches URL paths with the router basename for SPA assets', async () => {
    const app = await fixture(runtime, { mode: 'exclude', routes: ['/app/private'] }, '/app');
    const response = await app.request('/app/private');
    expect(await response.text()).toContain('/assets/private.js');
    expect(app.lazy).not.toHaveBeenCalled();
  });

  it('snapshots environment rollback rules without rebuilding or invoking decide', async () => {
    vi.stubEnv('SSR_BOOST_SSR_ROUTES', '!/public');
    const decide = vi.fn(() => 'ssr' as const);
    const app = await fixture(runtime, { decide });
    vi.stubEnv('SSR_BOOST_SSR_ROUTES', '/public');
    expect(await (await app.request('/public')).text()).not.toContain(
      '__staticRouterHydrationData',
    );
    expect(await (await app.request('/')).text()).toContain('__staticRouterHydrationData');
    expect(
      await (await app.request('/public', { headers: { 'User-Agent': 'Googlebot' } })).text(),
    ).toContain('__staticRouterHydrationData');
    expect(decide).not.toHaveBeenCalled();
  });

  it('keeps the production shell in memory across repeated requests', async () => {
    const app = await fixture(runtime, { mode: 'exclude', routes: ['/private'] });
    const body = await (await app.request('/private')).text();
    const index = join(directory, 'client/index.html');
    const original = await readFile(index, 'utf8');
    try {
      await writeFile(index, 'not a usable shell');
      expect(await (await app.request('/private')).text()).toBe(body);
    } finally {
      await writeFile(index, original);
    }
  });
});

describe('SPA shells and document header rules', () => {
  it('applies documentHeaders rules to the SPA shell, with the privacy default for sessions', async () => {
    const getHtml = await loadHtmlShell({ indexFile: join(directory, 'client/index.html') });
    const send = createHandler(
      {
        handler: createStaticHandler([{ id: 'private', path: '/private', Component: () => <p>SPA</p> }]),
        createApp: (children) => <App>{children}</App>,
        renderToStream,
      },
      {
        ssr: { mode: 'exclude', routes: ['/private'] },
        getHtml,
        sessionCookie: 'session',
        documentHeaders: [{ when: () => true, set: { 'Cache-Control': 'public, max-age=30' } }],
      },
    );
    const guest = await send(new Request('http://example.test/private', { headers: { 'user-agent': human } }));
    const member = await send(
      new Request('http://example.test/private', {
        headers: { 'user-agent': human, cookie: 'session=abc' },
      }),
    );

    expect(await guest.text()).toContain('data-force-spa="1"');
    expect(guest.headers.get('Cache-Control')).toBe('public, max-age=30');
    expect(member.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
