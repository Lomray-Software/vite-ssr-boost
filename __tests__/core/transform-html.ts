import { describe, expect, it, vi } from 'vitest';
import composeHtml from '@core/compose-html';
import transformHtml from '@core/transform-html';
import Diagnostics from '@services/diagnostics';

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

  it('observes split UTF-8 without changing bytes or chunk boundaries when no hook is installed', async () => {
    const diagnostics = new Diagnostics('/bytes', { warn: vi.fn() });
    const append = vi.spyOn(diagnostics, 'append');
    const complete = vi.spyOn(diagnostics, 'complete');
    const emoji = new TextEncoder().encode('🙂');
    const chunks = [new Uint8Array(), emoji.slice(0, 2), emoji.slice(2), new Uint8Array([0xff])];
    const reader = transformHtml(createStream(...chunks), undefined, diagnostics).getReader();

    for (const chunk of chunks) {
      expect((await reader.read()).value).toBe(chunk);
      expect(complete).not.toHaveBeenCalled();
    }
    expect(await reader.read()).toEqual({ done: true, value: undefined });
    expect(append.mock.calls.map(([html]) => html).join('')).toBe('🙂�');
    expect(complete).toHaveBeenCalledOnce();
  });

  describe.each(
    [false, true].flatMap((enabled) => [false, true].map((withHook) => ({ enabled, withHook }))),
  )('stream semantics with diagnostics=$enabled, onResponse=$withHook', ({ enabled, withHook }) => {
    const observe = (stream: ReadableStream<Uint8Array>) => {
      const diagnostics = enabled ? new Diagnostics('/stream', { warn: vi.fn() }) : undefined;
      const complete = diagnostics ? vi.spyOn(diagnostics, 'complete') : undefined;
      const hook = withHook ? vi.fn((html: string) => html) : undefined;
      return { stream: transformHtml(stream, hook, diagnostics), complete, hook };
    };

    it('does not read ahead of the consumer, including across the HTML shell boundary', async () => {
      const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new TextEncoder().encode('body'));
      });
      const source = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
      const { stream } = observe(composeHtml('header', source, 'footer'));
      const reader = stream.getReader();
      await Promise.resolve();
      expect(pull).not.toHaveBeenCalled();

      expect(new TextDecoder().decode((await reader.read()).value)).toBe('header');
      await Promise.resolve();
      expect(pull).not.toHaveBeenCalled();

      expect(new TextDecoder().decode((await reader.read()).value)).toBe('body');
      await Promise.resolve();
      expect(pull).toHaveBeenCalledOnce();

      await reader.read();
      await Promise.resolve();
      expect(pull).toHaveBeenCalledTimes(2);
      await reader.cancel();
    });

    it.each([undefined, new Error('client disconnected')])(
      'forwards cancel(%s) immediately while a read is pending and skips completion',
      async (reason) => {
        let notifyPull!: () => void;
        const pulling = new Promise<void>((resolve) => {
          notifyPull = resolve;
        });
        const cancel = vi.fn();
        const source = new ReadableStream<Uint8Array>(
          { pull: () => notifyPull(), cancel },
          { highWaterMark: 0 },
        );
        const { stream, complete, hook } = observe(source);
        const reader = stream.getReader();
        const reading = reader.read();
        await pulling;

        const cancelled = reader.cancel(reason);
        expect(cancel).toHaveBeenCalledOnce();
        expect(cancel.mock.calls[0][0]).toBe(reason);
        await cancelled;
        expect(await reading).toEqual({ done: true, value: undefined });
        expect(complete?.mock.calls ?? []).toEqual([]);
        expect(hook?.mock.calls ?? []).toEqual([]);
        reader.releaseLock();
        expect(source.locked).toBe(false);
      },
    );

    it('preserves the source error identity and does not run final hooks or diagnostics', async () => {
      const error = new Error('source failed');
      const source = new ReadableStream<Uint8Array>(
        { pull: (controller) => controller.error(error) },
        { highWaterMark: 0 },
      );
      const { stream, complete, hook } = observe(source);
      const reader = stream.getReader();
      await expect(reader.read()).rejects.toBe(error);
      await expect(reader.closed).rejects.toBe(error);
      expect(complete?.mock.calls ?? []).toEqual([]);
      expect(hook?.mock.calls ?? []).toEqual([]);
      reader.releaseLock();
    });

    it('preserves a source cancellation rejection', async () => {
      const reason = new Error('client disconnected');
      const failure = new Error('cancel failed');
      const cancel = vi.fn().mockRejectedValue(failure);
      const source = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
      const { stream, complete } = observe(source);
      const reader = stream.getReader();
      await expect(reader.cancel(reason)).rejects.toBe(failure);
      expect(cancel.mock.calls[0][0]).toBe(reason);
      expect(complete?.mock.calls ?? []).toEqual([]);
      reader.releaseLock();
      expect(source.locked).toBe(false);
    });
  });

  it.each([false, true])(
    'preserves hook errors and cancels the source (diagnostics=%s)',
    async (enabled) => {
      const error = new Error('hook failed');
      const cancel = vi.fn().mockRejectedValue(new Error('cleanup failed'));
      const source = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(new TextEncoder().encode('body')),
        cancel,
      });
      const diagnostics = enabled ? new Diagnostics('/hook-error', { warn: vi.fn() }) : undefined;
      const complete = diagnostics ? vi.spyOn(diagnostics, 'complete') : undefined;
      const reader = transformHtml(
        source,
        () => {
          throw error;
        },
        diagnostics,
      ).getReader();

      await expect(reader.read()).rejects.toBe(error);
      expect(cancel.mock.calls[0][0]).toBe(error);
      expect(complete?.mock.calls ?? []).toEqual([]);
      reader.releaseLock();
    },
  );
});
