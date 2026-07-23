// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import Fastify from 'fastify';
import { Hono } from 'hono';
import React from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler, redirect } from 'react-router';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import adapterEdge from '@adapters/edge';
import adapterExpress from '@adapters/express';
import adapterFastify from '@adapters/fastify';
import adapterHono from '@adapters/hono';
import adapterNode from '@adapters/node';
import createHandler from '@core/handler';
import type { TRenderToStream } from '@core/render';
import type { TSsrHandler } from '@core/types';
import edgeRenderToStream from '@edge/render-to-stream';
import nodeRenderToStream from '@node/render-to-stream';

interface IRuntime {
  close: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

interface IRuntimeFactory {
  name: string;
  start: (handler: TSsrHandler) => Promise<IRuntime>;
  renderer: TRenderToStream;
}

const createSsrHandler = (renderToStream: TRenderToStream): TSsrHandler => {
  const routes: RouteObject[] = [
    {
      Component: () => <main>Привет from SSR</main>,
      path: '*',
    },
    {
      Component: () => null,
      loader: () => redirect('/render'),
      path: '/redirect',
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
      onRequest: ({ request }) => {
        if (new URL(request.url).pathname === '/short-circuit') {
          return new Response('short-circuit', { status: 418 });
        }

        const headers = new Headers({ 'X-Conformance': 'passed' });

        headers.append('Set-Cookie', 'one=1; Path=/');
        headers.append('Set-Cookie', 'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

        return { headers, status: 207 };
      },
      onResponse: ({ html }) => html.replace('Привет', 'Hello'),
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

const factories: IRuntimeFactory[] = [
  {
    name: 'Node',
    renderer: nodeRenderToStream,
    start: async (handler) => {
      const server = http.createServer(adapterNode(handler));
      const origin = await listen(server);

      return {
        close: () => closeServer(server),
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
        request: (path, init) => fetch(`${origin}${path}`, init),
      };
    },
  },
  {
    name: 'Fastify',
    renderer: nodeRenderToStream,
    start: async (handler) => {
      const app = Fastify();

      app.all('/*', adapterFastify(handler));

      const origin = await app.listen({ host: '127.0.0.1', port: 0 });

      return {
        close: () => app.close(),
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
  let runtime: IRuntime;

  beforeAll(async () => {
    runtime = await start(createSsrHandler(renderer));
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

  it('preserves router redirects', async () => {
    const response = await runtime.request('/redirect', { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/render');
  });

  it('preserves a direct core Response', async () => {
    const response = await runtime.request('/short-circuit');

    expect(response.status).toBe(418);
    await expect(response.text()).resolves.toBe('short-circuit');
  });
});
