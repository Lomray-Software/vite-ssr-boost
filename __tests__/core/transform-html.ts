import { describe, expect, it, vi } from 'vitest';
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

  it('honors empty-string output', async () => {
    const stream = createStream(new TextEncoder().encode('content'));

    await expect(new Response(transformHtml(stream, () => '')).text()).resolves.toBe('');
  });

  it('keeps the original chunk when the transform returns undefined', async () => {
    const stream = createStream(new TextEncoder().encode('content'));
    const transform = vi.fn(() => undefined);

    await expect(new Response(transformHtml(stream, transform)).text()).resolves.toBe('content');
    expect(transform.mock.calls).toEqual([
      ['content', false],
      ['', true],
    ]);
  });

  it('combines withheld chunks and flushes remaining content once at the end', async () => {
    const encoder = new TextEncoder();
    const stream = createStream(
      encoder.encode('<scr'),
      encoder.encode('ipt>value</script>'),
      encoder.encode('<unfinished'),
    );
    let pending = '';
    const transform = vi.fn((html: string, isEnd: boolean) => {
      pending += html;

      if (!isEnd && !pending.endsWith('>')) {
        return '';
      }

      const output = pending;
      pending = '';

      return output;
    });

    await expect(new Response(transformHtml(stream, transform)).text()).resolves.toBe(
      '<script>value</script><unfinished',
    );
    expect(transform.mock.calls).toEqual([
      ['<scr', false],
      ['ipt>value</script>', false],
      ['<unfinished', false],
      ['', true],
    ]);
  });

  it('flushes the UTF-8 decoder before signaling the end', async () => {
    const emoji = new TextEncoder().encode('🙂');
    const stream = createStream(emoji.slice(0, 2));
    const transform = vi.fn((html: string, isEnd: boolean) => (isEnd ? '-END' : html));

    await expect(new Response(transformHtml(stream, transform)).text()).resolves.toBe('�-END');
    expect(transform.mock.calls).toEqual([
      ['�', false],
      ['', true],
    ]);
  });

  it('signals the end of an empty stream', async () => {
    const transform = vi.fn(() => 'END');

    await expect(new Response(transformHtml(createStream(), transform)).text()).resolves.toBe(
      'END',
    );
    expect(transform.mock.calls).toEqual([['', true]]);
  });
});
