// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import adapterExpress from '@adapters/express';

describe('Express adapter', () => {
  let port: number;
  let server: http.Server;

  beforeAll(async () => {
    const app = express();

    app.use(
      '/ssr',
      adapterExpress(async (request) => new Response(new URL(request.url).pathname)),
    );
    app.use(
      '/error',
      adapterExpress(async () => {
        throw new Error('adapter failed');
      }),
    );
    app.use(
      (error: Error, _: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(503).send(error.message);
      },
    );

    server = http.createServer(app).listen(0, '127.0.0.1');

    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', resolve));
    }

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const request = (pathname: string): Promise<{ body: string; statusCode: number }> =>
    new Promise((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', path: pathname, port }, (res) => {
          let body = '';

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve({ body, statusCode: res.statusCode! }));
        })
        .on('error', reject);
    });

  it('preserves originalUrl when mounted as middleware', async () => {
    await expect(request('/ssr/nested')).resolves.toEqual({
      body: '/ssr/nested',
      statusCode: 200,
    });
  });

  it('forwards errors to Express', async () => {
    await expect(request('/error')).resolves.toEqual({
      body: 'adapter failed',
      statusCode: 503,
    });
  });
});
