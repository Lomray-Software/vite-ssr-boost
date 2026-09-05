import * as ReactDOMServer from 'react-dom/server';
import type { TRenderToStream } from '@core/render';

/**
 * Let React select its workerd/Bun/Deno renderer. Node's React 18 entry lacks Web streams.
 */
const getRenderer = async (): Promise<typeof ReactDOMServer.renderToReadableStream> =>
  ReactDOMServer.renderToReadableStream ??
  (await import('react-dom/server.browser')).renderToReadableStream;

/**
 * Adapt React Web streams and settle readiness even when initialization is aborted.
 */
const renderToStream: TRenderToStream = async (node, { onError, signal }) => {
  const controller = new AbortController();
  let rejectPending!: (reason: Error) => void;

  /**
   * Interrupt initialization even if React never settles its shell promise.
   */
  const pendingAbort = new Promise<never>((_, reject) => {
    rejectPending = reject;
  });

  /**
   * Reject pending readiness when the platform request is cancelled.
   */
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

  let stream: Awaited<ReturnType<typeof ReactDOMServer.renderToReadableStream>>;

  try {
    stream = await Promise.race([
      getRenderer().then((renderToReadableStream) =>
        renderToReadableStream(node, { onError, signal: controller.signal }),
      ),
      pendingAbort,
    ]);
  } catch (error) {
    signal.removeEventListener('abort', abort);
    const shellError = Promise.reject(error);

    void shellError.catch(() => undefined);

    return {
      allReady: shellError,

      /**
       * Cancel the Web renderer with the reason supplied by the core.
       */
      abort: (reason) => controller.abort(reason),
      shellReady: shellError,

      /**
       * Web rendering starts through pulls and needs no separate pipe operation.
       */
      start: () => undefined,
      stream: new ReadableStream<Uint8Array>(),
    };
  }

  /**
   * Detach the cancellation listener once React settles.
   */
  const removeAbortListener = (): void => signal.removeEventListener('abort', abort);

  void stream.allReady.then(removeAbortListener, removeAbortListener);

  return {
    allReady: stream.allReady,

    /**
     * Cancel the Web renderer with the reason supplied by the core.
     */
    abort: (reason) => controller.abort(reason),
    shellReady: Promise.resolve(),

    /**
     * Web rendering starts through pulls and needs no separate pipe operation.
     */
    start: () => undefined,
    stream,
  };
};

export default renderToStream;
