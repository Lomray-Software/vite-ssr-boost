// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import staticFiles from '@adapters/express/static-files';
import serveStatic from '@node/serve-static';
import type { IServeStaticOptions } from '@node/serve-static';

type TOptions = Omit<IServeStaticOptions, 'root' | 'basename' | 'isSPA'>;

const PATHS = [
  '/',
  '/items',
  '/items/1?sort=name',
  '/assets/app.js',
  '/%61ssets/app.js?v=1',
  '/ASSETS/app.js',
  '/assets',
  '/assets/missing.js',
  '/robots.txt',
  '/health',
  '/about',
  '/missing',
  '/.env',
  '/.well-known/assetlinks.json',
  '/%2Ewell-known/assetlinks.json',
  '/.well-known/apple-app-site-association',
  '/.well-known/assetlinks',
  '/.well-known/../.env',
  '/.well-known/%2E%2E/.env',
  '/.well-known/missing',
  '/%E0%A4%A',
  '//robots.txt',
  '/a\\b',
  '/a%00b',
];

const OPTION_SETS: TOptions[] = [
  {},
  { extensions: ['html'] },
  { extensions: [] },
  { extensions: ['html'], fallthrough: false },
  { dotfiles: 'allow' },
  { dotfiles: 'deny', fallthrough: false },
  { dotfiles: 'ignore' },
];

/**
 * Listen on an ephemeral port and return the mounted origin.
 */
const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/base`;
};

/**
 * Compare the observable outcome of one request, leaving out per-response headers.
 */
const observe = async (url: string, init?: RequestInit) => {
  const response = await fetch(url, { redirect: 'manual', ...init });

  // Error bodies come from each host's own error handler; the status is the contract.
  if (response.status >= 400) {
    return { status: response.status };
  }

  return {
    status: response.status,
    body: await response.text(),
    type: response.headers.get('content-type'),
    length: response.headers.get('content-length'),
    location: response.headers.get('location'),
    ranges: response.headers.get('accept-ranges'),
    etag: Boolean(response.headers.get('etag')),
  };
};

describe('node serveStatic', () => {
  let root: string;
  let servers: Server[] = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ssr-serve-static-'));
    await mkdir(path.join(root, 'assets'));
    await writeFile(path.join(root, 'assets', 'app.js'), 'built-script');
    await writeFile(path.join(root, 'assets', 'index-AbCd1234.js'), 'fingerprinted');
    await writeFile(path.join(root, 'assets', 'site-settings.js'), 'stable');
    await writeFile(path.join(root, 'assets', 'icon-facebook.svg'), 'public-icon');
    await mkdir(path.join(root, 'assets', 'chunks'));
    await writeFile(path.join(root, 'assets', 'chunks', 'page.B7x_k2Qa.js'), 'nested-chunk');
    await writeFile(path.join(root, 'robots.txt'), 'public-file');
    await writeFile(path.join(root, 'health'), 'extensionless');
    await writeFile(path.join(root, 'about.html'), 'extension-fallback');
    await writeFile(path.join(root, 'index.html'), 'document');
    await mkdir(path.join(root, '.well-known'));
    await writeFile(path.join(root, '.well-known', 'assetlinks.json'), '[]');
    await writeFile(path.join(root, '.well-known', 'apple-app-site-association.json'), '{}');
    await writeFile(path.join(root, '.env'), 'secret');
  });

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    servers = [];
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Start the Express static stack the kit replaces, behind an SSR fallback.
   */
  const startLegacy = (options: TOptions, isSPA: boolean): Promise<string> => {
    const app = express();

    app.use('/base', staticFiles(root, { ...options, index: isSPA ? undefined : false }, isSPA));
    app.use((_, response) => response.status(200).send('SSR'));
    const server = http.createServer(app);

    servers.push(server);

    return listen(server);
  };

  /**
   * Start the node kit middleware on a bare node:http server.
   */
  const startNode = (
    options: TOptions,
    isSPA: boolean,
    extra: Partial<IServeStaticOptions> = {},
  ): Promise<string> => {
    const middleware = serveStatic({ root, basename: '/base', isSPA, ...options, ...extra });
    const server = http.createServer((req, res) => {
      middleware(req, res, (error) => {
        if (error) {
          res.statusCode = (error as { status?: number }).status ?? 500;
          res.end();

          return;
        }

        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end('SSR');
      });
    });

    servers.push(server);

    return listen(server);
  };

  it.each(
    OPTION_SETS.flatMap((options) => [true, false].map((isSPA) => [options, isSPA] as const)),
  )('matches the Express static stack for %j (SPA: %s)', async (options, isSPA) => {
    const legacy = await startLegacy(options, isSPA);
    const node = await startNode(options, isSPA);

    for (const pathname of PATHS) {
      const [expected, actual] = await Promise.all([
        observe(legacy + pathname),
        observe(node + pathname),
      ]);

      // Express labels its own text fallback differently; the body decides the route.
      if (expected.body === 'SSR') {
        expect(actual.body, pathname).toBe('SSR');
        continue;
      }

      expect(actual, pathname).toEqual(expected);
    }
  });

  it('matches HEAD, ranges and validators', async () => {
    const legacy = await startLegacy({}, false);
    const node = await startNode({}, false);

    for (const init of [
      { method: 'HEAD' },
      { headers: { Range: 'bytes=0-4' } },
      { headers: { Range: 'bytes=50-60' } },
    ] as RequestInit[]) {
      expect(await observe(`${node}/assets/app.js`, init)).toEqual(
        await observe(`${legacy}/assets/app.js`, init),
      );
    }

    const first = await fetch(`${node}/assets/app.js`);
    const cached = await fetch(`${node}/assets/app.js`, {
      headers: { 'If-None-Match': first.headers.get('etag')!, 'Cache-Control': 'max-age=0' },
    });

    expect(cached.status).toBe(304);
    expect((await fetch(`${node}/assets/app.js`, { method: 'POST' })).status).toBe(200);
    expect(await (await fetch(`${node}/assets/app.js`, { method: 'POST' })).text()).toBe('SSR');
  });

  it('caches only the listed build files as immutable', async () => {
    const immutableFiles = ['assets/index-AbCd1234.js', '/assets/chunks/page.B7x_k2Qa.js'];
    const node = await startNode({}, false, { immutableFiles });

    /**
     * Cache-Control the node middleware sends for one path.
     */
    const policy = async (url: string) => (await fetch(url)).headers.get('cache-control');

    expect(await policy(`${node}/assets/index-AbCd1234.js`)).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await policy(`${node}/assets/chunks/page.B7x_k2Qa.js`)).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(await policy(`${node}/assets/site-settings.js`)).toBe('public, max-age=0');
    expect(await policy(`${node}/assets/icon-facebook.svg`)).toBe('public, max-age=0');
    expect(await policy(`${node}/assets/app.js`)).toBe('public, max-age=0');
    expect(await policy(`${node}/robots.txt`)).toBe('public, max-age=0');

    const custom = await startNode({ maxAge: '1h' }, false, { immutableFiles });

    expect(await policy(`${custom}/assets/index-AbCd1234.js`)).toBe('public, max-age=3600');
  });

  it('revalidates every file when the build listed no hashed files', async () => {
    const node = await startNode({}, false);

    expect((await fetch(`${node}/assets/index-AbCd1234.js`)).headers.get('cache-control')).toBe(
      'public, max-age=0',
    );
  });

  it('shields the SSR document unless access is granted, and serves it in SPA mode', async () => {
    let isAllowed = false;
    const node = await startNode({}, false, { hasAccessIndexHtml: () => isAllowed });

    expect(await (await fetch(`${node}/index.html`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/INDEX.HTML`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/assets/../index.html`)).text()).toBe('SSR');

    isAllowed = true;
    expect(await (await fetch(`${node}/index.html`)).text()).toBe('document');

    const spa = await startNode({}, true);

    expect(await (await fetch(`${spa}/index.html`)).text()).toBe('document');
    expect(await (await fetch(`${spa}/`)).text()).toBe('document');
  });

  it('only serves inside its mount and restores the URL for the next handler', async () => {
    const middleware = serveStatic({ root, basename: '/Base/' });
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      middleware(req, res, () => {
        seen.push(req.url!);
        res.end('SSR');
      });
    });

    servers.push(server);

    const origin = (await listen(server)).replace(/\/base$/, '');

    expect(await (await fetch(`${origin}/robots.txt`)).text()).toBe('SSR');
    expect(await (await fetch(`${origin}/basement/robots.txt`)).text()).toBe('SSR');
    expect(await (await fetch(`${origin}/BASE/robots.txt`)).text()).toBe('public-file');
    expect(await (await fetch(`${origin}/base/items?x=1`)).text()).toBe('SSR');
    expect(seen).toEqual(['/robots.txt', '/basement/robots.txt', '/base/items?x=1']);
  });
});
