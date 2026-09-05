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

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = transform ? new TextEncoder() : undefined;
  let isStopped = false;

  /**
   * Observe emitted text after the hook has chosen whether to keep or replace it.
   */
  const emit = (html: string, controller: ReadableStreamDefaultController<Uint8Array>): void => {
    controller.enqueue(encoder!.encode(html));
    diagnostics?.append(String(html));
  };

  /**
   * Keep the original HTML when the response hook does not replace a chunk.
   */
  const apply = (html: string, controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!html) {
      return;
    }

    const result = transform?.(html, false);

    diagnostics?.inspectOnResponse(result);
    emit(result ?? html, controller);
  };

  return new ReadableStream<Uint8Array>(
    {
      /**
       * Forward cancellation immediately, without waiting for an in-flight pipe write.
       */
      cancel: async (reason) => {
        isStopped = true;

        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },

      /**
       * Read only on downstream demand and leave observed bytes untouched without a hook.
       */
      pull: async (controller) => {
        try {
          while (!isStopped) {
            const chunk = await reader.read();

            if (isStopped) {
              return;
            }

            if (chunk.done) {
              const remaining = decoder.decode();

              if (transform) {
                apply(remaining, controller);

                const html = transform('', true);

                diagnostics?.inspectOnResponse(html);

                if (html) {
                  emit(html, controller);
                }
              } else if (remaining) {
                diagnostics?.append(remaining);
              }

              diagnostics?.complete();
              isStopped = true;
              reader.releaseLock();
              controller.close();

              return;
            }

            const html = decoder.decode(chunk.value, { stream: true });

            if (transform) {
              if (!html) {
                continue;
              }

              apply(html, controller);
            } else {
              diagnostics?.append(html);
              controller.enqueue(chunk.value);
            }

            return;
          }
        } catch (error) {
          if (isStopped) {
            return;
          }

          isStopped = true;
          controller.error(error);

          try {
            await reader.cancel(error).catch(() => undefined);
          } finally {
            reader.releaseLock();
          }
        }
      },
    },
    // An observer must not add another queue or read React ahead of the consumer.
    { highWaterMark: 0 },
  );
};

export type { TTransformHtml };

export default transformHtml;
