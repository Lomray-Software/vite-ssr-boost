// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import staticFiles from '@adapters/express/static-files';
import serveStatic, { getShellGuardKeys, getShellKey } from '@node/serve-static';
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
 * The path goes out byte for byte, as a client that skips URL normalization sends it.
 */
const observe = (
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Record<string, unknown>> => {
  const { origin } = new URL(url);

  return new Promise((resolve, reject) => {
    const request = http.request(
      origin,
      { path: url.slice(origin.length), method: init.method ?? 'GET', headers: init.headers },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const status = response.statusCode!;

          // Error bodies come from each host's own error handler; the status is the contract.
          if (status >= 400) {
            resolve({ status });

            return;
          }

          resolve({
            status,
            body: Buffer.concat(chunks).toString('utf8'),
            type: response.headers['content-type'] ?? null,
            length: response.headers['content-length'] ?? null,
            location: response.headers.location ?? null,
            ranges: response.headers['accept-ranges'] ?? null,
            etag: Boolean(response.headers.etag),
          });
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
};

/**
 * Send one GET with a raw request target, such as the absolute form a proxy uses.
 */
const observeTarget = (
  url: string,
  target: string,
): Promise<{ status: number; body: string; location?: string }> => {
  const { hostname, port } = new URL(url);

  return new Promise((resolve, reject) => {
    const request = http.request(
      { hostname, port, path: target, method: 'GET', headers: { host: `${hostname}:${port}` } },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode!,
            body: Buffer.concat(chunks).toString('utf8'),
            location: response.headers.location,
          }),
        );
      },
    );

    request.on('error', reject);
    request.end();
  });
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

      // Only an explicit `dotfiles: 'allow'` may expose a dotfile, whatever the spelling.
      if (options.dotfiles !== 'allow') {
        expect(actual.body, pathname).not.toBe('secret');
      }

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
    ]) {
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

  it('hides the shell by the file it resolves to, whatever its name', async () => {
    await writeFile(path.join(root, 'shell.html'), 'renamed-shell');
    await writeFile(path.join(root, 'index-not-found.html'), 'public-page');
    let isAllowed = false;
    const renamed = await startNode({}, false, {
      shellFile: path.join(root, 'shell.html'),
      hasAccessIndexHtml: () => isAllowed,
    });

    expect(await (await fetch(`${renamed}/shell.html`)).text()).toBe('SSR');
    expect(await (await fetch(`${renamed}/Shell.HTML`)).text()).toBe('SSR');
    expect(await (await fetch(`${renamed}/index-not-found.html`)).text()).toBe('public-page');

    isAllowed = true;
    expect(await (await fetch(`${renamed}/shell.html`)).text()).toBe('renamed-shell');

    const withExtensions = await startNode({ extensions: ['html'] }, false);

    expect(await (await fetch(`${withExtensions}/index`)).text()).toBe('SSR');
    expect(await (await fetch(`${withExtensions}/index.html`)).text()).toBe('SSR');
    expect(await (await fetch(`${withExtensions}/about`)).text()).toBe('extension-fallback');
  });

  it('serves a real extensionless file that shares a name with the shell alias', async () => {
    const withExtensions = await startNode({ extensions: ['html'] }, false);

    expect(await (await fetch(`${withExtensions}/index`)).text()).toBe('SSR');

    await writeFile(path.join(root, 'index'), 'extensionless-index');

    expect(await (await fetch(`${withExtensions}/index`)).text()).toBe('extensionless-index');
    expect(await (await fetch(`${withExtensions}/index.html`)).text()).toBe('SSR');

    await writeFile(path.join(root, '.well-known', 'shell.json'), 'well-known-shell');
    const wellKnown = await startNode({}, false, {
      shellFile: path.join(root, '.well-known', 'shell.json'),
    });

    expect(await (await fetch(`${wellKnown}/.well-known/shell`)).text()).toBe('SSR');

    await writeFile(path.join(root, '.well-known', 'shell'), 'well-known-file');

    expect(await (await fetch(`${wellKnown}/.well-known/shell`)).text()).toBe('well-known-file');
    expect(await (await fetch(`${wellKnown}/.well-known/shell.json`)).text()).toBe('SSR');
  });

  it('hides the shell under a relative root', async () => {
    const node = await startNode({ extensions: ['html'] }, false, {
      root: path.relative(process.cwd(), root),
    });

    expect(await (await fetch(`${node}/index.html`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/INDEX.HTML`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/assets/../index.html`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/index`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/about`)).text()).toBe('extension-fallback');

    await writeFile(path.join(root, 'index'), 'extensionless-index');

    expect(await (await fetch(`${node}/index`)).text()).toBe('extensionless-index');
  });

  it('resolves the shell alias in send order without the shell extension', async () => {
    await writeFile(path.join(root, 'index.txt'), 'text-index');
    const node = await startNode({ extensions: ['txt', 'html'] }, false);

    expect(await (await fetch(`${node}/index`)).text()).toBe('text-index');
    expect(await (await fetch(`${node}/index.html`)).text()).toBe('SSR');

    await rm(path.join(root, 'index.txt'));

    expect(await (await fetch(`${node}/index`)).text()).toBe('SSR');
  });

  it('hides the shell behind every multi-part extension its name ends with', async () => {
    await writeFile(path.join(root, 'page.en.html'), 'localized-shell');
    const shellFile = 'page.en.html';
    const single = await startNode({ extensions: ['en.html'] }, false, { shellFile });

    expect(await (await fetch(`${single}/page`)).text()).toBe('SSR');
    expect(await (await fetch(`${single}/page.en.html`)).text()).toBe('SSR');

    const both = await startNode({ extensions: ['html', 'EN.HTML'] }, false, { shellFile });

    expect(await (await fetch(`${both}/page`)).text()).toBe('SSR');
    expect(await (await fetch(`${both}/page.en`)).text()).toBe('SSR');
    expect(await (await fetch(`${both}/about`)).text()).toBe('extension-fallback');

    await writeFile(path.join(root, 'page.html'), 'plain-page');

    expect(await (await fetch(`${both}/page`)).text()).toBe('plain-page');
  });

  it('keeps a leading dot in an extension the way send appends it', async () => {
    await writeFile(path.join(root, 'page..html'), 'double-dot-shell');
    const shellFile = 'page..html';
    const dotted = await startNode({ extensions: ['.html'] }, false, { shellFile });

    expect(await (await fetch(`${dotted}/page`)).text()).toBe('SSR');
    expect(await (await fetch(`${dotted}/page..html`)).text()).toBe('SSR');
    expect(await (await fetch(`${dotted}/about`)).text()).toBe('SSR');

    const plain = await startNode({ extensions: ['html'] }, false);

    expect(await (await fetch(`${plain}/index`)).text()).toBe('SSR');
    expect(await (await fetch(`${plain}/about`)).text()).toBe('extension-fallback');
  });

  it('sends a shell alias miss to the router under fallthrough false', async () => {
    const node = await startNode({ extensions: ['html'], fallthrough: false }, false);
    const alias = await fetch(`${node}/index`);

    expect(alias.status).toBe(200);
    expect(await alias.text()).toBe('SSR');
    expect(await (await fetch(`${node}/index`, { method: 'POST' })).text()).toBe('SSR');
    expect(await (await fetch(`${node}/about`)).text()).toBe('extension-fallback');
    expect((await fetch(`${node}/missing`)).status).toBe(404);

    await writeFile(path.join(root, 'index'), 'extensionless-index');

    expect(await (await fetch(`${node}/index`)).text()).toBe('extensionless-index');
  });

  it('redirects a directory that shares the extensionless name of the shell', async () => {
    await mkdir(path.join(root, 'index'));
    await writeFile(path.join(root, 'index', 'page.txt'), 'nested');
    const node = await startNode({ extensions: ['html'] }, false);
    const response = await fetch(`${node}/index`, { redirect: 'manual' });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('/base/index/');
    expect(await (await fetch(`${node}/index.html`)).text()).toBe('SSR');
  });

  it('hides the shell for raw paths with a fragment or a backslash', async () => {
    await mkdir(path.join(root, 'nested'));
    await writeFile(path.join(root, 'nested', 'shell.html'), 'nested-shell');

    for (const extra of [{}, { shellFile: 'nested/shell.html' }]) {
      const node = await startNode({ extensions: ['html'] }, false, extra);
      const shell = extra.shellFile ? '/nested/shell' : '/index';

      for (const pathname of [`${shell}#x`, `${shell}.html#x`, `${shell}.html?a=1#x`]) {
        const { body } = await observe(node + pathname);

        expect(body ?? 'error', pathname).not.toMatch(/document|nested-shell/);
      }
    }

    // Only the interior separators turn into backslashes, so the URL stays under the mount.
    const node = await startNode({ extensions: ['html'] }, false, {
      shellFile: 'nested/shell.html',
    });

    for (const pathname of ['/nested\\shell.html', '/nested\\shell', '/Nested\\Shell.html']) {
      expect((await observe(node + pathname)).body, pathname).toBe('SSR');
    }
  });

  it('reads an absolute-form target by its path, so the shell stays hidden', async () => {
    for (const options of [{}, { extensions: ['html'] }, { fallthrough: false }]) {
      const node = await startNode(options, false);
      const { origin } = new URL(node);

      for (const pathname of ['/index.html', '/INDEX.html', '/assets/../index.html']) {
        expect(
          (await observeTarget(node, `${origin}/base${pathname}`)).body,
          `${JSON.stringify(options)} ${pathname}`,
        ).toBe('SSR');
      }

      expect((await observeTarget(node, `${origin}/base/assets/app.js`)).body).toBe(
        'built-script',
      );
      expect((await observeTarget(node, `${origin}/elsewhere/index.html`)).body).toBe('SSR');
    }
  });

  it('answers a raw dot-segment target the same in the absolute and the origin form', async () => {
    // A file beside the root, which no target may reach.
    const outside = `${root}-outside.txt`;

    await writeFile(outside, 'outside-root');
    onTestFinished(() => rm(outside, { force: true }));

    for (const options of [{}, { extensions: ['html'] }, { fallthrough: false }]) {
      const node = await startNode(options, false);
      const { origin } = new URL(node);
      const targets = [
        '/base/assets/../index.html',
        '/base/assets/../index',
        '/base/x/../assets/app.js',
        `/base/../${path.basename(outside)}`,
        `/base/assets/../../${path.basename(outside)}`,
        '/base/.well-known/../.env',
        '/base/.well-known/../index.html',
      ];

      for (const target of targets) {
        const [plain, absolute] = await Promise.all([
          observeTarget(node, target),
          observeTarget(node, `${origin}${target}`),
        ]);

        expect(absolute, `${JSON.stringify(options)} ${target}`).toEqual(plain);
        expect(absolute.body ?? '', target).not.toMatch(/document|outside-root|secret/);
      }
    }
  });

  it('redirects an absolute-form directory target to its path, not the client host', async () => {
    const node = await startNode({}, false);
    const { status, location } = await observeTarget(node, 'http://other.example/base/assets');

    expect(status).toBe(301);
    expect(location).toBe('/base/assets/');
  });

  it('redirects an absolute-form directory target to its path inside an Express app', async () => {
    const app = express();

    app.use(serveStatic({ root, basename: '/base', isSPA: false }));
    app.use((_req, res) => {
      res.end('SSR');
    });

    const server = http.createServer(app);

    servers.push(server);

    const node = await listen(server);
    const { status, location } = await observeTarget(node, 'http://other.example/base/assets');

    expect(status).toBe(301);
    expect(location).toBe('/base/assets/');
  });

  it('reads an absolute-form target at the root mount by its path', async () => {
    // A raw target missed the shell key while serve-static found the file.
    for (const options of [{ extensions: ['html'] }, { fallthrough: false }]) {
      const rootMounted = await startNode(options, false, { basename: '/' });
      const { origin } = new URL(rootMounted);

      expect((await observeTarget(rootMounted, `${origin}/index.html`)).body).toBe('SSR');
    }
  });

  it('folds backslashes, dot segments and case into one shell key', () => {
    expect(getShellKey('/Nested\\Shell.html')).toBe('/nested/shell.html');
    expect(getShellKey('/nested/./x/../shell.html')).toBe('/nested/shell.html');
  });

  it('trims trailing dots and spaces from each segment only on Windows', () => {
    expect(getShellKey('/Index.HTML. ', true)).toBe('/index.html');
    expect(getShellKey('/nested. /shell.html ', true)).toBe('/nested/shell.html');
    expect(getShellKey('/assets/.../index.html', true)).toBe('/assets/.../index.html');
    expect(getShellKey('/index.html.', false)).toBe('/index.html.');
  });

  it('keys the configured shell and its aliases like a request on Windows', () => {
    expect(getShellGuardKeys('/index.html.', [], true).shellPath).toBe('/index.html');
    expect(getShellGuardKeys('/index.html.', [], false).shellPath).toBe('/index.html.');
    expect([...getShellGuardKeys('/index.html', ['html.'], true).aliases]).toEqual([
      ['/index', 'html'],
    ]);
    expect([...getShellGuardKeys('/index.html', ['html.'], false).aliases]).toEqual([]);
    expect([...getShellGuardKeys('/Index.HTML', ['HTML. '], true).aliases]).toEqual([
      ['/index', 'html'],
    ]);
  });

  it('reads serve-static options inherited from a prototype', async () => {
    const middleware = serveStatic(
      Object.create({ root, basename: '/base', extensions: ['html'] }) as IServeStaticOptions,
    );
    const server = http.createServer((req, res) => {
      middleware(req, res, () => res.end('SSR'));
    });

    servers.push(server);

    const node = await listen(server);

    expect(await (await fetch(`${node}/about`)).text()).toBe('extension-fallback');
    expect(await (await fetch(`${node}/index`)).text()).toBe('SSR');
  });

  it('hides a well-known shell under both spellings unless access is granted', async () => {
    await writeFile(path.join(root, '.well-known', 'shell.json'), 'well-known-shell');
    let isAllowed = false;
    const node = await startNode({}, false, {
      shellFile: path.join(root, '.well-known', 'shell.json'),
      hasAccessIndexHtml: () => isAllowed,
    });

    expect(await (await fetch(`${node}/.well-known/shell.json`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/.well-known/shell`)).text()).toBe('SSR');
    expect(await (await fetch(`${node}/.well-known/assetlinks`)).text()).toBe('[]');

    isAllowed = true;
    expect(await (await fetch(`${node}/.well-known/shell.json`)).text()).toBe('well-known-shell');
    expect(await (await fetch(`${node}/.well-known/shell`)).text()).toBe('well-known-shell');
  });

  it('sends no-cache for the SPA document and keeps the other files revalidating', async () => {
    const immutableFiles = ['assets/index-AbCd1234.js'];
    const spa = await startNode({}, true, { immutableFiles });

    /**
     * Cache-Control the node middleware sends for one path.
     */
    const policy = async (url: string) => (await fetch(url)).headers.get('cache-control');

    expect(await policy(`${spa}/`)).toBe('no-cache');
    expect(await policy(`${spa}/index.html`)).toBe('no-cache');
    expect(await policy(`${spa}/robots.txt`)).toBe('public, max-age=0');
    expect(await policy(`${spa}/assets/index-AbCd1234.js`)).toBe(
      'public, max-age=31536000, immutable',
    );

    const plain = await startNode({}, true);

    expect(await policy(`${plain}/`)).toBe('no-cache');
    expect(await policy(`${plain}/robots.txt`)).toBe('public, max-age=0');

    const listed = await startNode({}, true, { immutableFiles: ['index.html', 'robots.txt'] });

    expect(await policy(`${listed}/`)).toBe('no-cache');
    expect(await policy(`${listed}/index.html`)).toBe('no-cache');
    expect(await policy(`${listed}/robots.txt`)).toBe('public, max-age=31536000, immutable');
  });

  it('hides a shell whose name starts with two dots', async () => {
    await writeFile(path.join(root, '..shell.html'), 'dotted-shell');
    const node = await startNode({ dotfiles: 'allow' }, false, {
      shellFile: path.join(root, '..shell.html'),
      hasAccessIndexHtml: () => false,
    });

    expect(await (await fetch(`${node}/..shell.html`)).text()).toBe('SSR');
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
