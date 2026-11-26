// @vitest-environment node
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import React from 'react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HUMAN } from '@__helpers__/request-handler';
import defineEntry from '@core/entry';
import type { IEntry, IEntryOptions } from '@core/entry';
import type { TSsrHandler } from '@core/types';
import { createProductionServer, prepareProduction } from '@node/production';
import type { ICreateProductionServerOptions, IProductionServer } from '@node/production';

interface IWireResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  rawHeaders: string[];
  body: Buffer;
  information: http.InformationEvent[];
}

const fixtureDir = fileURLToPath(new URL('../../__mocks__/production-build/', import.meta.url));
const ASSET = '/assets/app-AbCdEf12.js';
let directory: string;
let buildDir: string;
let started: IProductionServer[];
let logger: { error: Mock<(message: string) => void> };

/** Wrap the matched route in a marker so tests can see the application rendered. */
const App = ({ children, server }: React.PropsWithChildren<{ server: { user?: string } }>) => (
  <main data-user={server.user}>{children}</main>
);

const routes = [
  { path: '/', Component: () => <p>Home</p> },
  { path: '/about', Component: () => <p>About</p> },
];

/** Module shape the build emits for a managed entry. */
const entryModule = (options?: IEntryOptions) => (): Promise<{ default: IEntry }> =>
  Promise.resolve({ default: defineEntry(App, routes, options) });

/** An entry that ignores host services and answers with the given handler. */
const handlerModule = (handler: TSsrHandler) => (): Promise<{ default: IEntry }> =>
  Promise.resolve({ default: Object.assign(() => handler, { kind: 'ssr-boost-entry' as const }) });

/** Start a production server on a random port and remember it for cleanup. */
const start = async (
  options: ICreateProductionServerOptions = {},
): Promise<{ app: IProductionServer; url: string }> => {
  const app = await createProductionServer({
    buildDir,
    logger,
    loadEntry: entryModule(),
    ...options,
  });

  started.push(app);

  const address = (await app.listen(0, '127.0.0.1')) as AddressInfo;

  return { app, url: `http://127.0.0.1:${address.port}` };
};

/** Send one request over a real socket and collect everything the wire carried. */
const request = (
  url: string,
  { method = 'GET', headers = {} }: { method?: string; headers?: http.OutgoingHttpHeaders } = {},
): Promise<IWireResponse> =>
  new Promise((resolve, reject) => {
    const information: http.InformationEvent[] = [];
    const req = http.request(
      url,
      { method, headers: { 'User-Agent': HUMAN, ...headers } },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode!,
            headers: res.headers,
            rawHeaders: res.rawHeaders,
            body: Buffer.concat(chunks),
            information,
          }),
        );
        res.on('error', reject);
      },
    );

    req.on('information', (info) => information.push(info));
    req.on('error', reject);
    req.end();
  });

/** Collect every Set-Cookie line separately, as the wire carried them. */
const getCookies = ({ rawHeaders }: IWireResponse): string[] =>
  rawHeaders.filter(
    (_, index) => index % 2 === 1 && rawHeaders[index - 1].toLowerCase() === 'set-cookie',
  );

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ssr-production-server-'));
  buildDir = join(directory, 'build');
  started = [];
  logger = { error: vi.fn<(message: string) => void>() };
  await cp(fixtureDir, buildDir, { recursive: true });
  await mkdir(join(buildDir, 'client/assets'), { recursive: true });
  await writeFile(join(buildDir, `client${ASSET}`), 'console.log("app");');
  await writeFile(join(buildDir, 'client/assets/icon-facebook.svg'), '<svg/>');
  await writeFile(
    join(buildDir, 'server/fingerprinted-files.json'),
    JSON.stringify([ASSET.slice(1)]),
  );
  await writeFile(join(buildDir, 'client/robots.txt'), 'User-agent: *');
});

afterEach(async () => {
  await Promise.all(
    started.map((app) => {
      app.server.closeAllConnections();

      return app.close();
    }),
  );
  await rm(directory, { recursive: true, force: true });
});

describe('prepareProduction', () => {
  it('resolves the conventional layout without ssr-boost.json', async () => {
    const { paths, staticMiddleware } = await prepareProduction({
      buildDir,
      loadEntry: entryModule(),
    });

    expect(paths).toEqual({
      root: buildDir,
      base: '/',
      publicDir: join(buildDir, 'client'),
      indexFile: join(buildDir, 'client/index.html'),
      serverFile: join(buildDir, 'server/server.js'),
    });
    expect(staticMiddleware).toBeTypeOf('function');
  });

  it('follows relocated paths and the base from ssr-boost.json', async () => {
    await rm(join(buildDir, 'client'), { recursive: true });
    await cp(join(fixtureDir, 'client'), join(buildDir, 'public'), { recursive: true });
    await writeFile(join(buildDir, 'public/robots.txt'), 'User-agent: *');
    await writeFile(
      join(buildDir, 'server/ssr-boost.json'),
      JSON.stringify({
        version: 1,
        root: '..',
        base: '/app/',
        mode: 'production',
        publicDir: 'public',
        indexFile: 'public/index.html',
        serverFile: 'server/entry.mjs',
      }),
    );
    const loadEntry = vi.fn(entryModule());
    const { app, url } = await start({ loadEntry });

    expect(loadEntry).toHaveBeenCalledWith(join(buildDir, 'server/entry.mjs'));
    expect(app.paths.publicDir).toBe(join(buildDir, 'public'));
    expect((await request(`${url}/app/robots.txt`)).body.toString()).toBe('User-agent: *');
    expect((await request(`${url}/robots.txt`)).status).toBe(404);
  });

  it('rejects a missing explicit build directory beside a valid conventional one', async () => {
    const originalCwd = process.cwd();

    process.chdir(directory);

    try {
      await expect(
        prepareProduction({ buildDir: 'missing', loadEntry: entryModule() }),
      ).rejects.toThrow('Build directory not found');
      await expect(prepareProduction({ loadEntry: entryModule() })).resolves.toMatchObject({
        paths: { serverFile: join(process.cwd(), 'build/server/server.js') },
      });
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('names the missing server entry and how to produce it', async () => {
    await expect(prepareProduction({ buildDir })).rejects.toThrow(
      `[ssr-boost] Server entry not found: ${join(buildDir, 'server/server.js')}. Run ssr-boost build or pass the build directory.`,
    );
  });

  it('explains that an Express entry needs the Express server', async () => {
    await expect(
      prepareProduction({
        buildDir,
        loadEntry: () => Promise.resolve({ default: { render: () => undefined } }),
      }),
    ).rejects.toThrow(
      "needs `export default defineEntry(App, routes)`; Express entries run with managedServer: 'express'",
    );
  });

  it('propagates other loader failures unchanged', async () => {
    const error = new SyntaxError('Unexpected token');

    await expect(
      prepareProduction({ buildDir, loadEntry: () => Promise.reject(error) }),
    ).rejects.toBe(error);
  });

  it('leaves client files to the host when static serving is disabled', async () => {
    const { staticMiddleware } = await prepareProduction({
      buildDir,
      loadEntry: entryModule(),
      static: false,
    });

    expect(staticMiddleware).toBeUndefined();
  });
});

describe('createProductionServer', () => {
  it('renders documents with route assets, Early Hints and separate cookies', async () => {
    const { url } = await start({
      loadEntry: entryModule({
        onRequest: () => ({
          appProps: { user: 'guest' },
          headers: [
            ['Set-Cookie', 'one=1; Path=/'],
            ['Set-Cookie', 'two=2; Path=/'],
          ],
        }),
      }),
    });
    const response = await request(`${url}/about`);
    const body = response.body.toString();
    const hints = response.information.find(({ statusCode }) => statusCode === 103);

    expect(response.status).toBe(200);
    expect(body).toContain('<main data-user="guest"><p>About</p></main>');
    expect(body).toContain('<link rel="stylesheet" href="/assets/about.css">');
    expect(hints?.headers.link).toContain('</assets/about.css>');
    expect(getCookies(response)).toEqual(['one=1; Path=/', 'two=2; Path=/']);
  });

  it('answers HEAD for documents and files without a body', async () => {
    const { url } = await start();
    const document = await request(`${url}/`, { method: 'HEAD' });
    const file = await request(`${url}/robots.txt`, { method: 'HEAD' });

    expect(document.status).toBe(200);
    expect(document.headers['content-type']).toContain('text/html');
    expect(document.body.length).toBe(0);
    expect(file.status).toBe(200);
    expect(file.headers['content-length']).toBe('13');
    expect(file.body.length).toBe(0);
  });

  it('caches the hashed files the build listed for a year and revalidates other files', async () => {
    const { url } = await start();
    const asset = await request(`${url}${ASSET}`);
    const icon = await request(`${url}/assets/icon-facebook.svg`);
    const file = await request(`${url}/robots.txt`);
    const range = await request(`${url}/robots.txt`, { headers: { Range: 'bytes=0-9' } });

    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(icon.headers['cache-control']).toBe('public, max-age=0');
    expect(file.headers['cache-control']).toBe('public, max-age=0');
    expect(file.headers.etag).toBeDefined();
    expect(range.status).toBe(206);
    expect(range.body.toString()).toBe('User-agent');
  });

  it('revalidates hashed names when the build left no list of its files', async () => {
    await rm(join(buildDir, 'server/fingerprinted-files.json'));
    const { url } = await start();

    expect((await request(`${url}${ASSET}`)).headers['cache-control']).toBe('public, max-age=0');
  });

  it('hides the raw SSR shell and leaves the path to the router', async () => {
    const { url } = await start();
    const hidden = await request(`${url}/index.html`);
    const allowed = await start({ hasAccessIndexHtml: () => true });
    const shell = await request(`${allowed.url}/index.html`);

    expect(hidden.status).toBe(404);
    expect(hidden.body.toString()).not.toContain('<!--ssr-outlet-->');
    expect(shell.body.toString()).toContain('<!--ssr-outlet-->');
  });

  it('serves the client document for every route in SPA mode', async () => {
    await rm(join(buildDir, 'server'), { recursive: true });
    const loadEntry = vi.fn();
    const { url } = await start({ isSPA: true, loadEntry });
    const route = await request(`${url}/deep/route`);
    const head = await request(`${url}/deep/route`, { method: 'HEAD' });

    expect(loadEntry).not.toHaveBeenCalled();
    expect(route.status).toBe(200);
    expect(route.headers['cache-control']).toBe('no-cache');
    expect(route.body.toString()).toContain('<title>Fixture</title>');
    expect(head.body.length).toBe(0);
    expect((await request(`${url}/robots.txt`)).body.toString()).toBe('User-agent: *');
  });

  it('sends client files to the document handler when static serving is disabled', async () => {
    const handler = vi.fn<TSsrHandler>(() => Promise.resolve(new Response('from handler')));
    const { url } = await start({ static: false, loadEntry: handlerModule(handler) });

    expect((await request(`${url}/robots.txt`)).body.toString()).toBe('from handler');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('compresses documents only, leaving files to their own policy', async () => {
    const { url } = await start({ compression: true });
    const headers = { 'Accept-Encoding': 'gzip' };
    const document = await request(`${url}/`, { headers });
    const file = await request(`${url}/robots.txt`, { headers });

    expect(document.headers['content-encoding']).toBe('gzip');
    expect(document.headers.vary).toContain('Accept-Encoding');
    expect(gunzipSync(document.body).toString()).toContain('<p>Home</p>');
    expect(file.headers['content-encoding']).toBeUndefined();
  });

  it('streams first bytes before the body ends and cancels on client disconnect', async () => {
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    const { url } = await start({
      loadEntry: handlerModule((req) => {
        signal = req.signal;

        return Promise.resolve(
          new Response(
            new ReadableStream({
              start: (controller) => controller.enqueue(new TextEncoder().encode('<p>first</p>')),
              cancel,
            }),
            { headers: { 'Content-Type': 'text/html' } },
          ),
        );
      }),
    });

    const first = await new Promise<string>((resolve, reject) => {
      http
        .get(`${url}/`, (res) => {
          res.once('data', (chunk: Buffer) => {
            res.destroy();
            resolve(chunk.toString());
          });
          res.on('error', () => undefined);
        })
        .on('error', reject);
    });

    expect(first).toBe('<p>first</p>');
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it('answers handler errors with their client status and logs only server errors', async () => {
    const { url } = await start({
      loadEntry: handlerModule((req) =>
        Promise.reject(
          new URL(req.url).pathname === '/large'
            ? Object.assign(new Error('too large'), { status: 413 })
            : new Error('boom'),
        ),
      ),
    });
    const large = await request(`${url}/large`);
    const broken = await request(`${url}/broken`);

    expect(large.status).toBe(413);
    expect(large.body.toString()).toBe('Payload Too Large');
    expect(broken.status).toBe(500);
    expect(broken.headers['cache-control']).toBe('no-store');
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith('Failed to handle request: boom', {
      error: expect.any(Error),
    });
  });

  it('reports readiness and drains active streams on close', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const { app, url } = await start({
      health: true,
      loadEntry: handlerModule(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start: (value) => {
                controller = value;
                value.enqueue(new TextEncoder().encode('start;'));
              },
            }),
          ),
        ),
      ),
    });

    expect((await request(`${url}/readyz`)).status).toBe(200);
    expect((await request(`${url}/healthz`)).body.toString()).toBe('ok');

    const streamed = new Promise<string>((resolve, reject) => {
      http
        .get(`${url}/stream`, (res) => {
          let body = '';

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });

    await vi.waitFor(() => expect(controller).toBeDefined());

    let isClosed = false;
    const closed = app.close().then(() => {
      isClosed = true;
    });

    expect(app.lifecycle.isReady()).toBe(false);
    expect(app.lifecycle.isDraining()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isClosed).toBe(false);

    controller.enqueue(new TextEncoder().encode('end'));
    controller.close();

    expect(await streamed).toBe('start;end');
    await closed;
    expect(isClosed).toBe(true);
    expect(app.close()).toBe(app.close());
  });

  it('runs onDrain once when the server closes', async () => {
    const onDrain = vi.fn();
    const { app } = await start({ onDrain });

    await Promise.all([app.close(), app.close()]);

    expect(onDrain).toHaveBeenCalledTimes(1);
  });

  it('rejects listen when the port is taken', async () => {
    const { app } = await start();
    const { port } = app.server.address() as AddressInfo;
    const other = await createProductionServer({ buildDir, logger, loadEntry: entryModule() });

    started.push(other);
    await expect(other.listen(port, '127.0.0.1')).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
