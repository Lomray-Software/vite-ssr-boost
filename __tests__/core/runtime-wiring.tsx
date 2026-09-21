// @vitest-environment node
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { documentRequest, streamRenderer } from '@__helpers__/request-handler';
import entry from '@adapters/express/entry';
import { createWorkerHandler } from '../../src/cloudflare';
import testHandlerFactory from '../../src/testing/create-handler';

const { writeResponse, assets } = vi.hoisted(() => ({
  writeResponse: vi.fn(),
  assets: vi.fn(() => []),
}));
vi.mock('@node/write-fetch-response', async (original) => ({
  ...(await original<object>()),
  default: writeResponse,
}));
vi.mock('@adapters/express/route-assets', () => ({
  default: async () => ({ injectAssets: assets }),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

/** Minimal legacy transport which retains headers but never opens a socket. */
const legacyRequest = (path = '/', method = 'GET') => {
  const headers = new Map<string, string | string[]>();
  const req = {
    originalUrl: path,
    url: path,
    method,
    protocol: 'https',
    headers: {
      host: 'example.test',
      cookie: 'session=secret',
      authorization: 'Bearer secret',
    } as Record<string, string>,
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
    once: vi.fn(),
    off: vi.fn(),
  };
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    once: vi.fn(),
    off: vi.fn(),
    getHeaders: () => Object.fromEntries(headers),
    setHeader: (name: string, value: string | string[]) => headers.set(name.toLowerCase(), value),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  const config = {
    isProd: true,
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
  return { context: { req, res, appProps: {}, html: { header: '', footer: '' } }, config };
};

describe('shared runtime across adapter closures', () => {
  it('guards the managed Express entry before request hooks and template loading', async () => {
    const app = entry(({ children }) => children, [{ path: '/' }]);
    const onRequest = vi.fn();
    const getHtml = vi.fn();
    const { config, context } = legacyRequest('/foo/../', 'GET');
    await app.render(config as never, context as never, { onRequest, getHtml });
    expect(onRequest).not.toHaveBeenCalled();
    expect(getHtml).not.toHaveBeenCalled();
    expect(writeResponse.mock.calls[0][1].status).toBe(400);
    expect(assets).not.toHaveBeenCalled();
  });

  it('reuses anonymous cached 404s in the managed Express entry', async () => {
    const onRequest = vi.fn((req) => {
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
      expect(req.cookies).toEqual({});
      return { appProps: {} };
    });
    const app = entry(({ children }) => children, [{ path: '/', errorElement: <p>missing</p> }], {
      notFound: 'cached',
    });
    writeResponse.mockImplementation(async (_, response: Response) => {
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('missing');
    });
    for (const path of ['/first', '/second']) {
      const { config, context } = legacyRequest(path);
      await app.render(config as never, context as never, {
        onRequest,
        getHtml: () => ({ header: '<html>', footer: '</html>' }),
      });
    }
    expect(onRequest).toHaveBeenCalledOnce();
    expect(writeResponse).toHaveBeenCalledTimes(2);
  });

  it('reuses cache and admission state across testing-kit fetch calls and forwards basename', async () => {
    const renderer = streamRenderer();
    const createTestHandler = testHandlerFactory(renderer.renderToStream, vi.fn());
    const onRequest = vi.fn();
    const cached = createTestHandler({ routes: [{ path: '/' }], notFound: 'cached', onRequest });
    const first = await cached.fetch('/missing');
    await first.html();
    await (await cached.fetch('/other')).html();
    expect(onRequest).toHaveBeenCalledOnce();
    const onEvent = vi.fn();
    const admitted = createTestHandler({
      routes: [{ path: '/' }],
      routerOptions: { basename: '/app' },
      admission: { maxConcurrency: 1, onEvent },
    });
    const held = await admitted.fetch('/app/');
    const rejected = await admitted.fetch('/app/');
    expect(rejected.status).toBe(503);
    await rejected.html();
    await held.html();
    expect(onEvent.mock.calls.map(([event]) => event.outcome)).toEqual([
      'admitted',
      'rejected',
      'finish',
    ]);
  });

  it('shares Worker caches and gives anonymous Requests to Worker hooks and getHtml', async () => {
    const onRequest = vi.fn(({ request }) => {
      expect(request.headers.has('Cookie')).toBe(false);
      return {};
    });
    const getHtml = vi.fn((request: Request) => {
      expect(request.headers.has('Cookie')).toBe(false);
      return { header: '<html>', footer: '</html>' };
    });
    const fetch = createWorkerHandler({
      App: ({ children }) => <>{children}</>,
      routes: [{ path: '/', errorElement: <p>missing worker</p> }],
      manifest: {} as never,
      getHtml,
      onRequest,
      assets: false,
      notFound: 'cached',
    });
    for (const path of ['/first', '/second']) {
      const response = await fetch(
        documentRequest(path, { headers: { Cookie: 'session=secret' } }),
        {},
        { waitUntil: vi.fn() },
      );
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('missing worker');
    }
    expect(onRequest).toHaveBeenCalledOnce();
    expect(getHtml).toHaveBeenCalledOnce();
  });
});
