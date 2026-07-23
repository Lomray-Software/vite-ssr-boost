type TTransformHtml = (html: string) => string | undefined | void;

const transformHtml = (
  stream: ReadableStream<Uint8Array>,
  transform?: TTransformHtml,
): ReadableStream<Uint8Array> => {
  if (!transform) {
    return stream;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const apply = (html: string, controller: TransformStreamDefaultController<Uint8Array>): void => {
    if (!html) {
      return;
    }

    controller.enqueue(encoder.encode(transform(html) || html));
  };

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush: (controller) => apply(decoder.decode(), controller),
      transform: (chunk, controller) => apply(decoder.decode(chunk, { stream: true }), controller),
    }),
  );
};

export type { TTransformHtml };

export default transformHtml;
