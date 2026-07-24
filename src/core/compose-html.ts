const composeHtml = (
  header: string,
  body: ReadableStream<Uint8Array>,
  footer: string,
  abort?: (reason?: unknown) => void,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let phase: 'body' | 'footer' | 'header' = 'header';

  return new ReadableStream<Uint8Array>({
    cancel: (reason) => {
      abort?.(reason);

      return reader.cancel(reason);
    },
    async pull(controller) {
      if (phase === 'header') {
        phase = 'body';

        if (header) {
          controller.enqueue(encoder.encode(header));

          return;
        }
      }

      if (phase === 'body') {
        let chunk: ReadableStreamReadResult<Uint8Array>;

        try {
          chunk = await reader.read();
        } catch (error) {
          abort?.(error);
          controller.error(error);

          return;
        }

        if (!chunk.done) {
          controller.enqueue(chunk.value);

          return;
        }

        phase = 'footer';
      }

      if (footer) {
        controller.enqueue(encoder.encode(footer));
      }

      controller.close();
    },
  });
};

export default composeHtml;
