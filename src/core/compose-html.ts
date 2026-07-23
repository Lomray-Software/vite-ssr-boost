const composeHtml = (
  header: string,
  body: ReadableStream<Uint8Array>,
  footer: string,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let phase: 'body' | 'footer' | 'header' = 'header';

  return new ReadableStream<Uint8Array>({
    cancel: (reason) => reader.cancel(reason),
    async pull(controller) {
      if (phase === 'header') {
        phase = 'body';

        if (header) {
          controller.enqueue(encoder.encode(header));

          return;
        }
      }

      if (phase === 'body') {
        const chunk = await reader.read();

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
