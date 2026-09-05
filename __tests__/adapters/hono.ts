// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import adapterHono from '@adapters/hono';

describe('Hono adapter', () => {
  it('passes Hono raw Request to the Fetch handler', async () => {
    const app = new Hono();

    app.all(
      '*',
      adapterHono(async (request) => {
        return new Response(`${request.method} ${new URL(request.url).pathname}`, {
          status: 202,
        });
      }),
    );

    const response = await app.request('/nested', { method: 'POST' });

    expect(response.status).toBe(202);
    await expect(response.text()).resolves.toBe('POST /nested');
  });
});
