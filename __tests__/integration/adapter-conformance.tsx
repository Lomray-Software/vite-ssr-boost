// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import React, { Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler, redirect } from 'react-router';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import adapterEdge from '@adapters/edge';
import adapterExpress from '@adapters/express';
import adapterFastify from '@adapters/fastify';
import adapterHono from '@adapters/hono';
import adapterNode from '@adapters/node';
import Navigate from '@components/navigate';
import ResponseStatus from '@components/response-status';
import createHandler from '@core/handler';
import type { TRenderToStream } from '@core/render';
import type { TSsrHandler } from '@core/types';
import edgeRenderToStream from '@edge/render-to-stream';
import nodeRenderToStream from '@node/render-to-stream';

interface IRuntime {
  close: () => Promise<void>;
  earlyHints?: () => Promise<number[]>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

interface IRuntimeFactory {
  name: string;
  start: (handler: TSsrHandler) => Promise<IRuntime>;
  renderer: TRenderToStream;
}

const Broken = (): never => {
  throw new Error('conformance render failure');
};
const Recoverable = () => (
  <Suspense fallback={<p data-recoverable-fallback>recoverable fallback</p>}>
    <Broken />
  </Suspense>
);

const createSsrHandler = (renderToStream: TRenderToStream, onAbort: () => void): TSsrHandler => {
  const routes: RouteObject[] = [
    ...[204, 205, 304].map((status) => ({
      Component: () => <ResponseStatus status={status} />,
      path: `/status-${status}`,
    })),
    {
      Component: Broken,
      path: '/shell-error',
    },
    {
      Component: Recoverable,
      path: '/recoverable',
    },
    {
      Component: () => null,
      loader: () => new Response(null, { status: 204 }),
      path: '/no-content',
    },
    {
      Component: () => <main>Привет from SSR</main>,
      path: '*',
    },
    {
      Component: () => null,
      loader: () => {
        const headers = new Headers({ Location: '/render', 'X-Conformance': 'redirect' });

        headers.append('Set-Cookie', 'redirect=1; Path=/');
        headers.append('Set-Cookie', 'expires=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

        return redirect('/render', { headers, status: 303 });
      },
      path: '/redirect',
    },
    {
      Component: () => <Navigate to="/render" />,
      path: '/navigate',
    },
  ];
  const handler = createStaticHandler(routes);

  return createHandler(
    {
      createApp: (children) => children,
      handler,
      renderToStream,
    },
    {
      getHtml: () => ({
        footer: '</div></body></html>',
        header: '<!doctype html><html><body><div id="root">',
      }),
      getState: () => ({ conformance: { passed: true } }),
      onRequest: async ({ request }) => {
        const pathname = new URL(request.url).pathname;

        if (pathname === '/short-circuit') {
          return new Response('short-circuit', { status: 418 });
        }

        if (pathname === '/request-body') {
          return new Response(`${request.method}:${await request.text()}`);
        }

        if (pathname === '/abort') {
          request.signal.addEventListener('abort', onAbort, { once: true });

          return new Response(
            new ReadableStream({
              start: (controller) => controller.enqueue(new TextEncoder().encode('shell')),
            }),
          );
        }

        const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Conformance': 'passed' });

        headers.append('Set-Cookie', 'one=1; Path=/');
        headers.append('Set-Cookie', 'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

        return {
          headers,
          status: pathname === '/no-content' ? undefined : 207,
        };
      },
      onResponse: ({ html }) => html.replace('Привет', 'Hello'),
      onRouterReady: ({ context }) => {
        if (new URL(context.request.url).pathname === '/navigate') {
          context.response.headers.set('X-Router-Ready', 'yes');
          context.response.headers.append('Set-Cookie', 'router=1; Path=/');
        }

        return {};
      },
      onShellError: ({ error }) => `<p data-shell-error>${error.message}</p>`,
      prepare: async ({ executionContext }) => {
        const hints = new Headers();

        hints.append('Link', '</app.css>; rel=preload; as=style');
        hints.append('Link', '</app.js>; rel=preload; as=script');
        await executionContext?.onEarlyHints?.(hints);
      },
    },
  );
};

const listen = async (server: http.Server): Promise<string> => {
  server.listen(0, '127.0.0.1');

  if (!server.listening) {
    await new Promise<void>((resolve) => server.once('listening', resolve));
  }

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const closeServer = async (server: http.Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

const requestEarlyHints = (origin: string): Promise<number[]> =>
  new Promise((resolve, reject) => {
    const statuses: number[] = [];
    const req = http.get(`${origin}/render`, (res) => {
      res.resume();
      res.on('end', () => resolve(statuses));
      res.on('error', reject);
    });

    req.on('information', ({ statusCode }) => statuses.push(statusCode));
    req.on('error', reject);
  });

const factories: IRuntimeFactory[] = [
  {
    name: 'Node',
    renderer: nodeRenderToStream,
    start: async (handler) => {
      const server = http.createServer(adapterNode(handler));
      const origin = await listen(server);

      return {
        close: () => closeServer(server),
        earlyHints: () => requestEarlyHints(origin),
        request: (path, init) => fetch(`${origin}${path}`, init),
      };
    },
  },
  {
    name: 'Express',
    renderer: nodeRenderToStream,
    start: async (handler) => {
      const app = express();

      app.use(adapterExpress(handler));

      const server = http.createServer(app);
      const origin = await listen(server);

      return {
        close: () => closeServer(server),
        earlyHints: () => requestEarlyHints(origin),
        request: (path, init) => fetch(`${origin}${path}`, init),
      };
    },
  },
  {
    name: 'Fastify',
    renderer: nodeRenderToStream,
    start: async (handler) => {
      // Fetch may open a replacement keep-alive socket after the cancellation test.
      const app = Fastify({ forceCloseConnections: true });

      app.all('/*', adapterFastify(handler));

      const origin = await app.listen({ host: '127.0.0.1', port: 0 });

      return {
        close: () => app.close(),
        earlyHints: () => requestEarlyHints(origin),
        request: (path, init) => fetch(`${origin}${path}`, init),
      };
    },
  },
  {
    name: 'Hono',
    renderer: edgeRenderToStream,
    start: async (handler) => {
      const app = new Hono();

      app.all('*', adapterHono(handler));

      return {
        close: async () => undefined,
        request: async (path, init) => app.request(path, init),
      };
    },
  },
  {
    name: 'edge fetch',
    renderer: edgeRenderToStream,
    start: async (handler) => {
      const fetchHandler = adapterEdge(handler);

      return {
        close: async () => undefined,
        request: (path, init) =>
          fetchHandler(new Request(new URL(path, 'https://edge.example'), init)),
      };
    },
  },
];

describe.each(factories)('$name SSR conformance', ({ renderer, start }) => {
  let abortCount = 0;
  let runtime: IRuntime;

  beforeAll(async () => {
    runtime = await start(
      createSsrHandler(renderer, () => {
        abortCount += 1;
      }),
    );
  });

  afterAll(async () => {
    await runtime.close();
  });

  it('streams identical HTML, status, headers and cookies', async () => {
    const response = await runtime.request('/render');
    const html = await response.text();

    expect(response.status).toBe(207);
    expect(response.headers.get('x-conformance')).toBe('passed');
    expect(response.headers.getSetCookie()).toEqual([
      'one=1; Path=/',
      'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    expect(html).toContain('<main>Hello from SSR</main>');
    expect(html).toContain('window.conformance');
    expect(html).toContain('</div></body></html>');
  });

  it.each([
    ['/redirect', 'GET', 303],
    ['/redirect', 'HEAD', 303],
    ['/navigate', 'GET', 301],
    ['/navigate', 'HEAD', 301],
  ])('merges hook headers and cookies for %s %s', async (path, method, status) => {
    const response = await runtime.request(String(path), {
      method: String(method),
      redirect: 'manual',
    });

    expect(response.status).toBe(status);
    expect(response.headers.get('location')).toBe('/render');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-conformance')).toBe(
      path === '/redirect' ? 'redirect' : 'passed',
    );
    expect(response.headers.getSetCookie()).toEqual([
      'one=1; Path=/',
      'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
      ...(path === '/redirect'
        ? ['redirect=1; Path=/', 'expires=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/']
        : ['router=1; Path=/']),
    ]);

    if (path === '/navigate') {
      expect(response.headers.get('x-router-ready')).toBe('yes');
    }

    await expect(response.text()).resolves.toBe('');
  });

  it('preserves a direct core Response', async () => {
    const response = await runtime.request('/short-circuit');

    expect(response.status).toBe(418);
    await expect(response.text()).resolves.toBe('short-circuit');
  });

  it('preserves request method and body', async () => {
    const response = await runtime.request('/request-body', {
      body: 'payload',
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST',
    });

    await expect(response.text()).resolves.toBe('POST:payload');
  });

  it('omits the response body for HEAD and null-body statuses', async () => {
    const head = await runtime.request('/render', { method: 'HEAD' });
    const noContent = await runtime.request('/no-content');

    expect(head.status).toBe(207);
    await expect(head.text()).resolves.toBe('');
    expect(noContent.status).toBe(204);
    await expect(noContent.text()).resolves.toBe('');
  });

  it.each([204, 205, 304])('preserves headers for ResponseStatus %s', async (status) => {
    const response = await runtime.request(`/status-${status}`);

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(response.headers.get('x-conformance')).toBe('passed');
    expect(response.headers.getSetCookie()).toHaveLength(2);
  });

  it('returns 500 for a shell error before the first flush', async () => {
    const response = await runtime.request('/shell-error');

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toContain('data-shell-error');
  });

  it.each(['/shell-error', '/short-circuit'])('omits HEAD bodies for %s', async (path) => {
    const response = await runtime.request(path, { method: 'HEAD' });

    expect(response.status).toBe(path === '/shell-error' ? 500 : 418);
    expect(response.body).toBeNull();
  });

  it('completes the footer after a recoverable render error', async () => {
    const response = await runtime.request('/recoverable');
    const html = await response.text();

    expect(response.status).toBe(207);
    expect(html).toContain('data-recoverable-fallback');
    expect(html).toContain('</div></body></html>');
  });

  it('propagates client cancellation to Request.signal', async () => {
    const controller = new AbortController();
    const response = await runtime.request('/abort', { signal: controller.signal });
    const reader = response.body!.getReader();

    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await vi.waitFor(() => expect(abortCount).toBe(1));
  });

  it('emits Early Hints on capable Node transports and no-ops elsewhere', async () => {
    if (runtime.earlyHints) {
      await expect(runtime.earlyHints()).resolves.toContain(103);
    } else {
      await expect(runtime.request('/render')).resolves.toBeInstanceOf(Response);
    }
  });
});
