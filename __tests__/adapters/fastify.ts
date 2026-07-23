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
          `${request.method} ${new URL(request.url).pathname} ${await request.text()}`,
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
    expect(response.body).toBe('POST /nested body');
    expect(response.headers['set-cookie']).toEqual(['one=1; Path=/', 'two=2; Path=/']);
  });
});
