type TTransformHtml = (html: string) => string | undefined | void;

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

    controller.enqueue(encoder.encode(transform(html) || html));
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      /**
       * Flush any final characters retained by the streaming decoder.
       */
      flush: (controller) => apply(decoder.decode(), controller),

      /**
       * Decode successive chunks using the same UTF-8 state.
       */
      transform: (chunk, controller) => apply(decoder.decode(chunk, { stream: true }), controller),
    }),
  );
};

export type { TTransformHtml };

export default transformHtml;
