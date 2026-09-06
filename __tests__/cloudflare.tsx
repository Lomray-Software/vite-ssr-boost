// @vitest-environment node
import React from 'react';
import { createStaticHandler } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createRouteAssetPreparer } from '@node/production';
import NodeRouteAssets from '@services/route-assets';
import type { TRouteAssetsManifest } from '@services/route-assets-memory';
import { createWorkerHandler, getHtmlFromAssets, RouteAssets } from '../src/cloudflare';
import type { IAssetsBinding } from '../src/cloudflare';

const document =
  '<!doctype html><html><head></head><body><div id="root"><!--ssr-outlet--></div></body></html>';
const manifest = {
  about: [
    {
      type: 'style',
      url: '/assets/about-abcdefgh.css',
      weight: 1,
      isNested: false,
      isPreload: false,
    },
    {
      type: 'script',
      url: '/assets/about-abcdefgh.js',
      weight: 2,
      isNested: false,
      isPreload: true,
    },
  ],
} satisfies TRouteAssetsManifest;
const routes = [{ id: 'about', path: '/about', Component: () => <p>About</p> }];
const App = ({ children }: React.PropsWithChildren) => <>{children}</>;

const context = async () => {
  const request = new Request('https://worker.example/about');
  const routerContext = await createStaticHandler(routes).query(request);
  if (routerContext instanceof Response) throw new Error('Expected router context');
  return {
    request,
    routerContext,
    appProps: {},
    response: { headers: new Headers() },
    html: { header: '<head></head>', footer: 'footer' },
  };
};

describe('in-memory route assets', () => {
  it('supports both constructors, a parsed JSON object and immutable manifests', async () => {
    const parsed = JSON.parse(JSON.stringify(manifest)) as TRouteAssetsManifest;
    Object.values(parsed).forEach(Object.freeze);
    Object.freeze(parsed);
    for (const Assets of [RouteAssets, NodeRouteAssets]) {
      const assets = new Assets(parsed, true);
      const first = await context();
      const second = await context();
      assets.injectAssets(first);
      assets.injectAssets(second);
      expect(first.html).toEqual(second.html);
      expect(first.html.header).toContain(
        '<link rel="stylesheet" href="/assets/about-abcdefgh.css">',
      );
      expect(first.html.header).toContain('rel="modulepreload"');
      expect(first.html.footer).toBe('footer');
      expect(parsed).toEqual(manifest);
    }
  });

  it('accepts manifest in the Node preparer and skips unsupported Early Hints', async () => {
    const hints = vi.spyOn(RouteAssets.prototype, 'getEarlyHints');
    try {
      const first = await context();
      await createRouteAssetPreparer({ manifest })({ context: first });
      expect(first.html.header).toContain('rel="stylesheet"');
      expect(hints).not.toHaveBeenCalled();
      const onEarlyHints = vi.fn();
      await createRouteAssetPreparer({ manifest })({
        context: await context(),
        executionContext: { onEarlyHints },
      });
      expect(onEarlyHints).toHaveBeenCalledOnce();
      expect(hints).toHaveBeenCalledOnce();
    } finally {
      hints.mockRestore();
    }
  });

  it('keeps independent manifests and unmatched routes isolated', async () => {
    const first = await context();
    const second = await context();
    new RouteAssets({}).injectAssets(first);
    new RouteAssets(manifest).injectAssets(second);
    expect(first.html.header).toBe('<head></head>');
    expect(second.html.header).toContain('/assets/about-abcdefgh.css');
  });
});

describe('getHtmlFromAssets', () => {
  it('loads once across concurrent calls and returns fresh shells for every request', async () => {
    const fetch = vi.fn(async () => new Response(document));
    const env = { ASSETS: { fetch } };
    const [getHtml, again] = await Promise.all([getHtmlFromAssets(env), getHtmlFromAssets(env)]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toHaveLength(1);
    const first = getHtml();
    const second = again();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.header = 'request mutation';
    expect(getHtml()).toEqual(second);
    await getHtmlFromAssets({ ASSETS: env.ASSETS });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keys its cache by binding, path and outlet, including custom names', async () => {
    const fetch = vi.fn(async () => new Response(document));
    const env = { STATIC: { fetch } };
    await getHtmlFromAssets(env, '/index.html', 'STATIC');
    await getHtmlFromAssets(env, '/other.html', 'STATIC');
    expect(fetch).toHaveBeenCalledTimes(2);
    const alternate = await getHtmlFromAssets(
      { STATIC: { fetch: async () => new Response('a{{app}}b') } },
      '/shell.html',
      'STATIC',
      '{{app}}',
    );
    expect(alternate()).toEqual({ header: 'a', footer: 'b' });
  });

  it('reports missing bindings, non-200 shells and invalid outlets; retries failures', async () => {
    await expect(getHtmlFromAssets({})).rejects.toThrow('Missing Workers assets binding "ASSETS"');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(new Response('no outlet'))
      .mockResolvedValueOnce(new Response('<!--ssr-outlet--><!--ssr-outlet-->'))
      .mockResolvedValueOnce(new Response(document));
    const env = { ASSETS: { fetch } };
    await expect(getHtmlFromAssets(env)).rejects.toThrow('/index.html');
    await expect(getHtmlFromAssets(env)).rejects.toThrow('expected exactly one');
    await expect(getHtmlFromAssets(env)).rejects.toThrow('expected exactly one');
    expect((await getHtmlFromAssets(env))().header).toContain('<head>');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

describe('createWorkerHandler', () => {
  it('forwards per-request bindings to all hooks and loaders', async () => {
    const seen: unknown[] = [];
    const nativeContext = {
      waitUntil: vi.fn(function (this: unknown) {
        expect(this).toBe(nativeContext);
      }),
    };
    const worker = createWorkerHandler<{ greeting: string }>({
      App,
      manifest,
      indexHtml: document,
      assets: false,
      routes: [
        {
          path: '/',
          Component: () => <p>Worker</p>,
          loader: ({ context: requestContext }) => {
            seen.push((requestContext as any).executionContext.platform.env.greeting);
            return null;
          },
        },
      ],
      onRequest: ({ executionContext }) => {
        expect(executionContext.platform.ctx).toBe(nativeContext);
        expect(executionContext.onEarlyHints).toBeUndefined();
        executionContext.waitUntil(Promise.resolve());
        return {};
      },
      prepare: ({ context: requestContext, executionContext }) => {
        expect(requestContext.executionContext).toBe(executionContext);
        seen.push(executionContext?.platform);
      },
      onShellReady: ({ context: requestContext }) => {
        expect(requestContext.executionContext?.platform).toBeDefined();
        return {};
      },
    });
    await Promise.all(
      ['one', 'two'].map(async (greeting) => {
        const response = await worker(
          new Request('https://worker.example/'),
          { greeting },
          nativeContext,
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('<p>Worker</p>');
      }),
    );
    expect(seen).toContain('one');
    expect(seen).toContain('two');
    expect(nativeContext.waitUntil).toHaveBeenCalledTimes(2);
  });

  it('uses custom assets, preserves headers, falls back on misses and never caches plain files forever', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      return path === '/about'
        ? new Response(null, { status: 404 })
        : new Response('asset', { headers: { ETag: 'version', 'Cache-Control': 'no-cache' } });
    });
    const worker = createWorkerHandler<{ STATIC: IAssetsBinding }>({
      App,
      routes,
      manifest,
      indexHtml: document,
      assets: 'STATIC',
    });
    const env = { STATIC: { fetch } };
    const ctx = { waitUntil: vi.fn() };
    const hashed = await worker(
      new Request('https://worker.example/assets/a-abcdefgh.css'),
      env,
      ctx,
    );
    expect(hashed.headers.get('ETag')).toBe('version');
    expect(hashed.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await hashed.text()).toBe('asset');
    const plain = await worker(new Request('https://worker.example/robots.txt'), env, ctx);
    expect(plain.headers.get('Cache-Control')).toBe('no-cache');
    const ssr = await worker(new Request('https://worker.example/about'), env, ctx);
    expect(await ssr.text()).toContain('<p>About</p>');
    const head = await worker(
      new Request('https://worker.example/assets/a-abcdefgh.css', { method: 'HEAD' }),
      env,
      ctx,
    );
    expect(await head.text()).toBe('');
  });

  it('bypasses assets for actions and supports onRequest response takeover', async () => {
    const fetch = vi.fn();
    const worker = createWorkerHandler({
      App,
      routes,
      manifest,
      indexHtml: document,
      onRequest: () => new Response('hook', { status: 202 }),
    });
    const response = await worker(
      new Request('https://worker.example/about', { method: 'POST' }),
      { ASSETS: { fetch } },
      { waitUntil: vi.fn() },
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('hook');
    expect(fetch).not.toHaveBeenCalled();
  });
});
