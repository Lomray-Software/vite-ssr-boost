/**
 * Stream the shell, React body and hydration footer under downstream backpressure.
 */
const composeHtml = (
  header: string,
  body: ReadableStream<Uint8Array>,
  footer: string,
  abort?: (reason?: unknown) => void,
  onComplete?: () => void,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let phase: 'body' | 'footer' | 'header' = 'header';

  return new ReadableStream<Uint8Array>({
    /**
     * Release the React reader when the response consumer cancels.
     */
    cancel: async (reason) => {
      abort?.(reason);

      if (phase === 'footer') {
        return;
      }

      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
        onComplete?.();
      }
    },

    /**
     * Emit one available shell or React chunk per downstream pull.
     */
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
          reader.releaseLock();
          onComplete?.();
          controller.error(error);

          return;
        }

        if (!chunk.done) {
          controller.enqueue(chunk.value);

          return;
        }

        phase = 'footer';
        reader.releaseLock();
        onComplete?.();
      }

      if (footer) {
        controller.enqueue(encoder.encode(footer));
      }

      controller.close();
    },
  });
};

export default composeHtml;
