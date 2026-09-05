// @vitest-environment node
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import createRequest from '@node/create-request';

describe('createRequest', () => {
  const createIncomingMessage = (body?: string) => {
    const req = Readable.from(body ? [body] : []) as Readable & {
      headers: Record<string, string>;
      method: string;
      socket: Record<string, unknown>;
      url: string;
    };

    req.headers = {
      host: 'example.com',
      'x-test': 'value',
    };
    req.method = body ? 'POST' : 'GET';
    req.socket = {};
    req.url = '/path?query=1';

    return req;
  };

  it('converts a native Node request to Fetch Request', async () => {
    const request = createRequest(createIncomingMessage('payload') as never);

    expect(request.url).toBe('http://example.com/path?query=1');
    expect(request.method).toBe('POST');
    expect(request.headers.get('x-test')).toBe('value');
    await expect(request.text()).resolves.toBe('payload');
  });

  it('accepts an explicit origin and signal', () => {
    const controller = new AbortController();
    const request = createRequest(createIncomingMessage() as never, {
      origin: 'https://public.example',
      signal: controller.signal,
    });

    controller.abort();

    expect(request.url).toBe('https://public.example/path?query=1');
    expect(request.signal.aborted).toBe(true);
  });

  it('uses an explicit parsed body supplied by an adapter', async () => {
    const incoming = createIncomingMessage('ignored');
    const request = createRequest(incoming as never, { body: 'parsed' });

    await expect(request.text()).resolves.toBe('parsed');
  });

  it('keeps double-slash paths on the original host', () => {
    const incoming = createIncomingMessage();
    incoming.url = '//other.example/path';

    expect(createRequest(incoming as never).url).toBe('http://example.com//other.example/path');
  });

  it('regenerates the boundary when getBody supplies FormData', async () => {
    const incoming = createIncomingMessage('original body');
    incoming.headers['content-type'] = 'multipart/form-data; boundary=old-boundary';
    incoming.headers['content-length'] = '13';
    const body = new FormData();
    body.append('name', 'Alice');
    const request = createRequest(incoming as never, { body });

    expect(request.headers.get('content-length')).toBeNull();
    expect((await request.formData()).get('name')).toBe('Alice');
  });
});
