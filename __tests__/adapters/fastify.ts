// @vitest-environment node
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import adapterFastify from '@adapters/fastify';

describe('Fastify adapter', () => {
  const app = Fastify();

  beforeAll(async () => {
    app.all(
      '/*',
      adapterFastify(async (request) => {
        const headers = new Headers();

        headers.append('Set-Cookie', 'one=1; Path=/');
        headers.append('Set-Cookie', 'two=2; Path=/');

        return new Response(
          `${request.method} ${new URL(request.url).pathname} ${await request.text()} length=${request.headers.get('Content-Length')}`,
          {
            headers,
            status: 202,
          },
        );
      }),
    );
    await app.ready();
  });

  afterAll(() => app.close());

  it('writes the Fetch response through Fastify raw transport', async () => {
    const response = await app.inject({
      headers: { 'Content-Type': 'text/plain' },
      method: 'POST',
      payload: 'body',
      url: '/nested',
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('POST /nested body length=null');
    expect(response.headers['set-cookie']).toEqual(['one=1; Path=/', 'two=2; Path=/']);
  });

  it('serializes Fastify parsed JSON into the Fetch request', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { value: 1 },
      url: '/json',
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('POST /json {"value":1} length=null');
  });

  it('lets getBody override Fastify parsed body', async () => {
    const custom = Fastify();

    custom.post(
      '/custom',
      adapterFastify(async (request) => new Response(await request.text()), {
        getBody: () => 'custom body',
      }),
    );

    try {
      const response = await custom.inject({
        method: 'POST',
        payload: { ignored: true },
        url: '/custom',
      });

      expect(response.body).toBe('custom body');
    } finally {
      await custom.close();
    }
  });

  it('preserves headers and cookies set by Fastify hooks', async () => {
    const custom = Fastify();

    custom.addHook('onRequest', async (_, reply) => {
      reply.header('X-From-Hook', 'yes');
      reply.header('Set-Cookie', 'hook=1; Path=/');
    });
    custom.get(
      '/',
      adapterFastify(
        async () =>
          new Response('ok', {
            headers: { 'Set-Cookie': 'handler=2; Path=/' },
          }),
      ),
    );

    try {
      const response = await custom.inject('/');

      expect(response.headers['x-from-hook']).toBe('yes');
      expect(response.headers['set-cookie']).toEqual(['hook=1; Path=/', 'handler=2; Path=/']);
    } finally {
      await custom.close();
    }
  });
});
