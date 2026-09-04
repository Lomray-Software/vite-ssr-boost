import { renderToReadableStream } from 'react-dom/server.browser';
import type { TRenderToStream } from '@core/render';

const renderToStream: TRenderToStream = async (node, { onError, signal }) => {
  const controller = new AbortController();
  let rejectPending!: (reason: Error) => void;
  const pendingAbort = new Promise<never>((_, reject) => {
    rejectPending = reject;
  });
  const abort = (): void => {
    const { reason: signalReason } = signal as { reason: unknown };

    controller.abort(signalReason);

    const { reason } = controller.signal as { reason: unknown };

    rejectPending(reason instanceof Error ? reason : new Error(String(reason)));
  };

  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }

  let stream: Awaited<ReturnType<typeof renderToReadableStream>>;

  try {
    stream = await Promise.race([
      renderToReadableStream(node, {
        onError,
        signal: controller.signal,
      }),
      pendingAbort,
    ]);
  } catch (error) {
    signal.removeEventListener('abort', abort);
    const shellError = Promise.reject(error);

    void shellError.catch(() => undefined);

    return {
      allReady: shellError,
      abort: (reason) => controller.abort(reason),
      shellReady: shellError,
      start: () => undefined,
      stream: new ReadableStream<Uint8Array>(),
    };
  }

  const removeAbortListener = (): void => signal.removeEventListener('abort', abort);

  void stream.allReady.then(removeAbortListener, removeAbortListener);

  return {
    allReady: stream.allReady,
    abort: (reason) => controller.abort(reason),
    shellReady: Promise.resolve(),
    start: () => undefined,
    stream,
  };
};

export default renderToStream;
