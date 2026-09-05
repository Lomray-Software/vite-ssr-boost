import { PassThrough, Readable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import type { TRenderToStream } from '@core/render';

/**
 * Adapt React pipeable rendering to Fetch streams with byte-based backpressure.
 */
const renderToStream: TRenderToStream = (node, options) => {
  const destination = new PassThrough();
  const stream = Readable.toWeb(destination, {
    strategy: {
      highWaterMark: destination.readableHighWaterMark,

      /**
       * Measure queued data in bytes, matching the Node stream high-water mark.
       */
      size: (chunk: Uint8Array) => chunk.byteLength,
    },
  }) as ReadableStream<Uint8Array>;
  let rejectAll!: (error: Error) => void;
  let rejectShell!: (error: Error) => void;
  let resolveAll!: () => void;
  let resolveShell!: () => void;

  /**
   * Track completion independently from the first available shell.
   */
  const allReady = new Promise<void>((resolve, reject) => {
    rejectAll = reject;
    resolveAll = resolve;
  });

  /**
   * Let the core wait for the shell without waiting for suspended content.
   */
  const shellReady = new Promise<void>((resolve, reject) => {
    rejectShell = reject;
    resolveShell = resolve;
  });

  void allReady.catch(() => undefined);
  void shellReady.catch(() => undefined);

  let hasShellSettled = false;
  let hasAborted = false;
  const rendered = renderToPipeableStream(node, {
    onAllReady: resolveAll,
    onError: options.onError,

    /**
     * Reject both readiness promises when React cannot create a shell.
     */
    onShellError: (error) => {
      const shellError = error instanceof Error ? error : new Error(String(error));

      hasShellSettled = true;
      rejectAll(shellError);
      rejectShell(shellError);
    },

    /**
     * Allow the core to commit headers once the shell is ready.
     */
    onShellReady: () => {
      hasShellSettled = true;
      resolveShell();
    },
  });

  /**
   * Settle pending React 18 readiness promises before aborting the renderer.
   */
  const abort = (reason?: unknown): void => {
    if (hasAborted) {
      return;
    }

    hasAborted = true;

    /**
     * React 18 may omit shell callbacks when the root task is aborted.
     */
    if (!hasShellSettled) {
      hasShellSettled = true;
      const message = typeof reason === 'string' ? reason : 'Render aborted';
      const error = reason instanceof Error ? reason : new Error(message);

      rejectShell(error);
      rejectAll(error);
    }

    rendered.abort(reason);
  };

  /**
   * Forward the transport cancellation reason to React.
   */
  const onAbort = (): void => abort(options.signal.reason);

  /**
   * Detach the transport signal after React settles.
   */
  const cleanup = (): void => options.signal.removeEventListener('abort', onAbort);

  if (options.signal.aborted) {
    onAbort();
  } else {
    options.signal.addEventListener('abort', onAbort, { once: true });
  }

  void allReady.then(cleanup, cleanup);
  let hasStarted = false;

  return {
    allReady,
    abort,
    shellReady,

    /**
     * Pipe only after the core has finalized response headers and hooks.
     */
    start: () => {
      if (!hasStarted) {
        hasStarted = true;
        rendered.pipe(destination);
      }
    },
    stream,
  };
};

export default renderToStream;
