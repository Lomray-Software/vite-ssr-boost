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
      adapterExpress(
        async (request) =>
          new Response(
            `${request.method} ${new URL(request.url).pathname} ${await request.text()}`.trim(),
          ),
      ),
    );
    app.use(
      '/json',
      express.json(),
      adapterExpress(async (request) => new Response(await request.text())),
    );
    app.use(
      '/form',
      express.urlencoded({ extended: false }),
      adapterExpress(async (request) => new Response(await request.text())),
    );
    app.use(
      '/nested-form',
      express.urlencoded({ extended: true }),
      adapterExpress(async (request) => new Response(await request.text())),
    );
    app.use(
      '/error',
      adapterExpress(async () => {
        throw new Error('adapter failed');
      }),
    );
    app.use(
      '/body-error',
      adapterExpress(async () => new Response('unreachable'), {
        getBody: () => {
          throw new Error('body conversion failed');
        },
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

  const request = (
    pathname: string,
    {
      body,
      headers,
      method = 'GET',
    }: { body?: string; headers?: http.OutgoingHttpHeaders; method?: string } = {},
  ): Promise<{ body: string; statusCode: number }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { headers, host: '127.0.0.1', method, path: pathname, port },
        (res) => {
          let body = '';

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve({ body, statusCode: res.statusCode! }));
        },
      );

      req.on('error', reject);
      req.end(body);
    });

  it('preserves originalUrl when mounted as middleware', async () => {
    await expect(request('/ssr/nested')).resolves.toEqual({
      body: 'GET /ssr/nested',
      statusCode: 200,
    });
  });

  it('streams an unparsed raw request body into Fetch', async () => {
    await expect(
      request('/ssr/raw', {
        body: 'raw payload',
        headers: { 'Content-Type': 'text/plain' },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: 'POST /ssr/raw raw payload',
      statusCode: 200,
    });
  });

  it('serializes parsed JSON and form bodies without corrupting content', async () => {
    await expect(
      request('/json', {
        body: '{"value":1}',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: '{"value":1}',
      statusCode: 200,
    });
    await expect(
      request('/form', {
        body: 'one=1&two=a&two=b',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: 'one=1&two=a&two=b',
      statusCode: 200,
    });
  });

  it('forwards errors to Express', async () => {
    await expect(request('/error')).resolves.toEqual({
      body: 'adapter failed',
      statusCode: 503,
    });
    await expect(
      request('/body-error', {
        body: 'payload',
        method: 'POST',
      }),
    ).resolves.toEqual({
      body: 'body conversion failed',
      statusCode: 503,
    });
  });

  it('reports unsupported nested forms from extended parsers', async () => {
    const response = await request('/nested-form', {
      body: 'user[name]=Alice',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('Provide the adapter getBody option');
  });
});
