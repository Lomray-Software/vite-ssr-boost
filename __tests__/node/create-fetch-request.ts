// @vitest-environment node
import { describe, expect, it } from 'vitest';
import createFetchRequest from '@node/create-fetch-request';

describe('createFetchRequest', () => {
  it('should convert express request to fetch request with headers and body', async () => {
    const closeHandlers: Array<() => void> = [];
    const req = {
      protocol: 'https',
      get: (name: string) => (name === 'host' ? 'example.com' : undefined),
      originalUrl: '/users?id=1',
      url: '/users?id=1',
      method: 'POST',
      headers: {
        'x-test': '1',
        cookie: ['a=1', 'b=2'],
      },
      body: 'payload',
      on: (_: string, handler: () => void) => {
        closeHandlers.push(handler);
      },
    };

    const request = createFetchRequest(req as never);

    expect(request.url).toBe('https://example.com/users?id=1');
    expect(request.method).toBe('POST');
    expect(request.headers.get('x-test')).toBe('1');
    expect(request.headers.get('cookie')).toBe('a=1; b=2');
    expect(await request.text()).toBe('payload');

    closeHandlers[0]?.();
    expect(request.signal.aborted).toBe(true);
  });

  it('should omit body for get requests', () => {
    const req = {
      protocol: 'http',
      get: () => 'localhost:3000',
      originalUrl: '/ping',
      url: '/ping',
      method: 'GET',
      headers: {},
      on: () => undefined,
    };

    const request = createFetchRequest(req as never);

    expect(request.method).toBe('GET');
    expect(request.body).toBeNull();
  });
});
