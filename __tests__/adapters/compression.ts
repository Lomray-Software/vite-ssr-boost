import { describe, expect, it } from 'vitest';
import compressResponse from '@adapters/compression';

const decompress = (response: Response, format: 'deflate' | 'gzip'): Promise<string> =>
  new Response(response.body!.pipeThrough(new DecompressionStream(format))).text();

describe('adapter compression', () => {
  it('negotiates and streams gzip without folding cookies', async () => {
    const headers = new Headers({ 'Content-Length': '7' });

    headers.append('Set-Cookie', 'one=1; Path=/');
    headers.append('Set-Cookie', 'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

    const response = compressResponse(
      new Request('https://example.com', {
        headers: { 'Accept-Encoding': 'br, gzip;q=0.8, deflate;q=0.5' },
      }),
      new Response('payload', { headers }),
      true,
    );

    expect(response.headers.get('content-encoding')).toBe('gzip');
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('vary')).toBe('Accept-Encoding');
    expect(response.headers.getSetCookie()).toEqual([
      'one=1; Path=/',
      'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/',
    ]);
    await expect(decompress(response, 'gzip')).resolves.toBe('payload');
  });

  it('keeps the original Response when compression is disabled or unsupported', () => {
    const response = new Response('payload');

    expect(compressResponse(new Request('https://example.com'), response)).toBe(response);

    const negotiated = compressResponse(
      new Request('https://example.com', { headers: { 'Accept-Encoding': 'gzip;q=0' } }),
      response,
      true,
    );

    expect(negotiated.headers.get('content-encoding')).toBeNull();
    expect(negotiated.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('does not recompress encoded, partial or no-transform responses', () => {
    const request = new Request('https://example.com', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const encoded = new Response('payload', { headers: { 'Content-Encoding': 'br' } });
    const partial = new Response('payload', { status: 206 });
    const noTransform = new Response('payload', {
      headers: { 'Cache-Control': 'private, no-transform' },
    });

    expect(compressResponse(request, encoded, true)).toBe(encoded);
    expect(compressResponse(request, partial, true)).toBe(partial);
    expect(compressResponse(request, noTransform, true)).toBe(noTransform);
  });
});
