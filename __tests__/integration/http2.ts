// @vitest-environment node
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import adapterFastify from '@adapters/fastify';
import adapterNode from '@adapters/node';
import { getHeaderEntries } from '@core/headers';
import type { TSsrHandler } from '@core/types';

describe.each(['Node', 'Fastify'])('%s HTTP/2 compatibility', (runtime) => {
  it.each(['POST', 'HEAD'])(
    'preserves %s authority, body semantics, cookies and Early Hints',
    async (method) => {
      const handler: TSsrHandler = async (request, context) => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'one=1; Path=/');
        headers.append('Set-Cookie', 'two=2; Path=/');
        context?.onEarlyHints?.(new Headers({ Link: '</app.css>; rel=preload; as=style' }));

        return Response.json(
          {
            body: await request.text(),
            headers: Object.fromEntries(getHeaderEntries(request.headers)),
            method: request.method,
            url: request.url,
          },
          { headers },
        );
      };
      const app = Fastify({ http2: true, forceCloseConnections: true });
      const server = runtime === 'Node' ? http2.createServer(adapterNode(handler)) : app.server;

      if (runtime === 'Node') {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      } else {
        app.all('/*', adapterFastify(handler));
        await app.listen({ host: '127.0.0.1', port: 0 });
      }

      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const session = http2.connect(origin);

      try {
        const request = session.request({
          ':method': method,
          ':path': '/form?q=1',
          'content-type': 'text/plain',
          'x-test': 'value',
        });
        const hints: number[] = [];
        let responseHeaders: http2.IncomingHttpHeaders = {};
        request.on('headers', (headers) => hints.push(Number(headers[':status'])));
        request.on('response', (headers) => {
          responseHeaders = headers;
        });
        request.end(method === 'POST' ? 'payload' : undefined);
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(chunk as Buffer);
        }

        expect(responseHeaders[':status']).toBe(200);
        expect(responseHeaders['set-cookie']).toEqual(['one=1; Path=/', 'two=2; Path=/']);
        expect(hints).toContain(103);
        if (method === 'HEAD') {
          expect(chunks).toHaveLength(0);
          return;
        }

        const body = JSON.parse(Buffer.concat(chunks).toString());
        expect(body).toMatchObject({ body: 'payload', method: 'POST', url: `${origin}/form?q=1` });
        expect(body.headers['x-test']).toBe('value');
        expect(Object.keys(body.headers).some((name) => name.startsWith(':'))).toBe(false);
      } finally {
        session.destroy();
        if (runtime === 'Node') {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        } else {
          await app.close();
        }
      }
    },
  );
});
