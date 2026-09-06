import type DataStream from '@core/data-stream';
import htmlBoundary from '@core/html-boundary';
import type RequestTimeline from '@services/request-timeline';

/** Stream shell, data frames, React bytes and footer only under downstream demand. */
const composeHtml = (
  header: string,
  body: ReadableStream<Uint8Array>,
  footer: string,
  abort?: (reason?: unknown) => void,
  onComplete?: () => void,
  data?: DataStream,
  timeline?: RequestTimeline,
  isEarly = false,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const reader = body.getReader();
  let phase: 'body' | 'footer' | 'header' = 'header';
  let isStopped = false;
  let isReleased = false;
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  const observe = htmlBoundary();
  let canInject = true;
  let heldChunk: Uint8Array | undefined;

  /** Release exactly once, including cancellation during an outstanding read. */
  const release = (): void => {
    if (!isReleased) {
      isReleased = true;
      reader.releaseLock();
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      /** Cancel immediately; a disconnected consumer cannot receive abort scripts. */
      cancel: async (reason) => {
        isStopped = true;
        abort?.(reason);
        data?.cancel();

        try {
          if (!isReleased) {
            await reader.cancel(reason);
          }
        } finally {
          release();
          onComplete?.();
        }
      },

      /** Keep at most the one React read requested by the current downstream pull. */
      async pull(controller) {
        try {
          if (phase === 'header') {
            phase = 'body';

            if (header) {
              if (isEarly) {
                timeline?.record('state.emitted', { placement: 'early' });
              }

              controller.enqueue(encoder.encode(header));

              return;
            }
          }

          while (!isStopped) {
            const frames = canInject ? data?.take() : undefined;

            if (isStopped) {
              return;
            }

            if (frames) {
              controller.enqueue(encoder.encode(frames));

              return;
            }

            if (heldChunk) {
              canInject = observe(heldChunk);
              controller.enqueue(heldChunk);
              heldChunk = undefined;

              return;
            }

            if (phase === 'body') {
              pendingRead ??= reader.read();
              const chunk = await (data && !data.isDone && canInject
                ? Promise.race([pendingRead, data.changed().then(() => undefined)])
                : pendingRead);

              if (isStopped) {
                return;
              }

              if (!chunk) {
                continue;
              }

              pendingRead = undefined;

              if (!chunk.done) {
                heldChunk = chunk.value;
                // Settle data already resolved by this React boundary before its HTML.
                continue;
              }

              phase = 'footer';
              timeline?.record('body.end');
              canInject = true;
              release();
              continue;
            }

            if (data && !data.isDone) {
              await data.changed();
              continue;
            }

            if (footer) {
              if (!isEarly) {
                timeline?.record('state.emitted', { placement: 'footer' });
              }

              controller.enqueue(encoder.encode(footer));
            }

            isStopped = true;
            onComplete?.();
            controller.close();
          }
        } catch (error) {
          if (isStopped) {
            return;
          }

          isStopped = true;
          abort?.(error);
          data?.cancel();
          controller.error(error);

          try {
            if (!isReleased) {
              await reader.cancel(error).catch(() => undefined);
            }
          } finally {
            release();
            onComplete?.();
          }
        }
      },
    },
    { highWaterMark: 0 },
  );
};

export default composeHtml;
