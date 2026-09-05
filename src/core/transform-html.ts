import type Diagnostics from '@services/diagnostics';

type TTransformHtml = (html: string, isEnd: boolean) => string | undefined | void;

/**
 * Apply response hooks to decoded text without splitting UTF-8 characters.
 */
const transformHtml = (
  stream: ReadableStream<Uint8Array>,
  transform?: TTransformHtml,
  diagnostics?: Diagnostics,
): ReadableStream<Uint8Array> => {
  if (!transform && !diagnostics) {
    return stream;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /**
   * Observe emitted text after the hook has chosen whether to keep or replace it.
   */
  const emit = (html: string, controller: TransformStreamDefaultController<Uint8Array>): void => {
    controller.enqueue(encoder.encode(html));
    diagnostics?.append(String(html));
  };

  /**
   * Keep the original HTML when the response hook does not replace a chunk.
   */
  const apply = (html: string, controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (!html) {
      return;
    }

    const result = transform?.(html, false);

    diagnostics?.inspectOnResponse(result);
    emit(result ?? html, controller);
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      /**
       * Flush the decoder before letting the response hook emit any retained content.
       */
      flush: (controller) => {
        apply(decoder.decode(), controller);

        const html = transform?.('', true);

        diagnostics?.inspectOnResponse(html);

        if (html) {
          emit(html, controller);
        }

        diagnostics?.complete();
      },

      /**
       * Decode successive chunks using the same UTF-8 state.
       */
      transform: (chunk, controller) => apply(decoder.decode(chunk, { stream: true }), controller),
    }),
  );
};

export type { TTransformHtml };

export default transformHtml;
