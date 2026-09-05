type TTransformHtml = (html: string, isEnd: boolean) => string | undefined | void;

/**
 * Apply response hooks to decoded text without splitting UTF-8 characters.
 */
const transformHtml = (
  stream: ReadableStream<Uint8Array>,
  transform?: TTransformHtml,
): ReadableStream<Uint8Array> => {
  if (!transform) {
    return stream;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /**
   * Keep the original HTML when the response hook does not replace a chunk.
   */
  const apply = (html: string, controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (!html) {
      return;
    }

    controller.enqueue(encoder.encode(transform(html, false) ?? html));
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      /**
       * Flush the decoder before letting the response hook emit any retained content.
       */
      flush: (controller) => {
        apply(decoder.decode(), controller);

        const html = transform('', true);

        if (html) {
          controller.enqueue(encoder.encode(html));
        }
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
