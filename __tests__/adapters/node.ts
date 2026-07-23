// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import adapterNode from '@adapters/node';

describe('Node adapter', () => {
  let port: number;
  let server: http.Server;
  let serverError: unknown;
  const aborted = vi.fn();

  beforeAll(async () => {
    const handler = adapterNode(async (request, context) => {
      if (new URL(request.url).pathname === '/abort') {
        request.signal.addEventListener('abort', aborted, { once: true });

        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('shell'));
            },
          }),
        );
      }

      const hints = new Headers();
      const headers = new Headers();

      hints.append('Link', '</app.css>; rel=preload; as=style');
      hints.append('Link', '</app.js>; rel=preload; as=script');
      headers.append('Set-Cookie', 'one=1; Path=/');
      headers.append('Set-Cookie', 'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');
      await context?.earlyHints?.(hints);

      return new Response(`url=${request.url};body=${await request.text()}`, {
        headers,
        status: 202,
      });
    });

    server = http
      .createServer((req, res) => {
        void handler(req, res, (error) => {
          serverError = error;
          res.statusCode = 500;
          res.end('Adapter failed');
        });
      })
      .listen(0, '127.0.0.1');

    if (!server.listening) {
      await new Promise<void>((resolve) => server.once('listening', resolve));
    }

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('writes streaming Response, Early Hints and separate cookies on the wire', async () => {
    const result = await new Promise<{
      body: string;
      information: http.InformationEvent[];
      rawHeaders: string[];
      statusCode: number;
    }>((resolve, reject) => {
      const information: http.InformationEvent[] = [];
      const req = http.request(
        {
          headers: { 'Content-Type': 'text/plain' },
          host: '127.0.0.1',
          method: 'POST',
          path: '/submit',
          port,
        },
        (res) => {
          let body = '';

          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({
              body,
              information,
              rawHeaders: res.rawHeaders,
              statusCode: res.statusCode!,
            });
          });
        },
      );

      req.on('information', (info) => information.push(info));
      req.on('error', reject);
      req.end('payload');
    });
    const cookies = result.rawHeaders
      .map((value, index) => ({ index, value }))
      .filter(({ index, value }) => index % 2 === 0 && value.toLowerCase() === 'set-cookie')
      .map(({ index }) => result.rawHeaders[index + 1]);
    const earlyHints = result.information.find(({ statusCode }) => statusCode === 103);

    expect(serverError).toBeUndefined();
    expect(result.statusCode).toBe(202);
    expect(result.body).toContain(`url=http://127.0.0.1:${port}/submit`);
    expect(result.body).toContain('body=payload');
    expect(cookies).toEqual([
      'one=1; Path=/',
      'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    expect(earlyHints?.headers.link).toContain('</app.css>');
    expect(earlyHints?.headers.link).toContain('</app.js>');
  });

  it('aborts Request.signal when the client disconnects', async () => {
    aborted.mockClear();

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          path: '/abort',
          port,
        },
        (res) => {
          res.once('data', () => {
            res.destroy();
            resolve();
          });
          res.on('error', () => undefined);
        },
      );

      req.on('error', reject);
      req.end();
    });
    await vi.waitFor(() => expect(aborted).toHaveBeenCalledOnce());
  });
});
