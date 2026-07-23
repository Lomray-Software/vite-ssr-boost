import { describe, expect, it } from 'vitest';
import transformHtml from '@core/transform-html';

const createStream = (...chunks: Uint8Array[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });

describe('transformHtml', () => {
  it('preserves split UTF-8 while transforming the stream', async () => {
    const encoder = new TextEncoder();
    const emoji = encoder.encode('🙂');
    const stream = createStream(
      encoder.encode('<main>ORIGINAL-before-'),
      emoji.slice(0, 2),
      new Uint8Array([...emoji.slice(2), ...encoder.encode('-after</main>')]),
    );
    const transformed = transformHtml(stream, (html) => html.replace('ORIGINAL', 'MODIFIED'));

    await expect(new Response(transformed).text()).resolves.toBe(
      '<main>MODIFIED-before-🙂-after</main>',
    );
  });

  it('does not add a transform on the hot path', () => {
    const stream = createStream();

    expect(transformHtml(stream)).toBe(stream);
  });

  it('preserves legacy empty-string behavior', async () => {
    const stream = createStream(new TextEncoder().encode('content'));

    await expect(new Response(transformHtml(stream, () => '')).text()).resolves.toBe('content');
  });
});
