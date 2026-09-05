import React, { Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import renderToStream from '@edge/render-to-stream';

const read = (stream: ReadableStream<Uint8Array>): Promise<string> => new Response(stream).text();

describe('edge/render-to-stream', () => {
  it('renders through a Web ReadableStream', async () => {
    const output = await renderToStream(<main>edge</main>, {
      onError: vi.fn(),
      signal: new AbortController().signal,
    });

    output.start();

    await expect(read(output.stream)).resolves.toContain('<main>edge</main>');
    await expect(output.allReady).resolves.toBeUndefined();
  });

  it('passes request aborts to React', async () => {
    const request = new AbortController();
    const pending = new Promise<never>(() => undefined);
    const onError = vi.fn();
    const output = await renderToStream(
      <Suspense fallback={<p>loading</p>}>
        {React.createElement(() => {
          throw pending;
        })}
      </Suspense>,
      { onError, signal: request.signal },
    );

    request.abort(new Error('disconnected'));

    await expect(read(output.stream)).resolves.toContain('loading');
    await expect(output.allReady).resolves.toBeUndefined();
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error('disconnected'));
  });

  it('rejects when the request aborts before React produces a shell', async () => {
    const request = new AbortController();
    const pending = new Promise<never>(() => undefined);
    const output = renderToStream(
      React.createElement(() => {
        throw pending;
      }),
      {
        onError: vi.fn(),
        signal: request.signal,
      },
    );
    const error = new Error('timed out');

    request.abort(error);

    const rendered = await output;

    expect(rendered).toMatchObject({
      allReady: expect.any(Promise),
      shellReady: expect.any(Promise),
    });
    await expect(rendered.shellReady).rejects.toBe(error);
  });
});
