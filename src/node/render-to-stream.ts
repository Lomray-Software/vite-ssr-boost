import { PassThrough, Readable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import type { TRenderToStream } from '@core/render';

const renderToStream: TRenderToStream = (node, options) => {
  const destination = new PassThrough();
  const stream = Readable.toWeb(destination, {
    strategy: {
      highWaterMark: destination.readableHighWaterMark,
      size: (chunk: Uint8Array) => chunk.byteLength,
    },
  }) as ReadableStream<Uint8Array>;
  let rejectAll!: (error: Error) => void;
  let rejectShell!: (error: Error) => void;
  let resolveAll!: () => void;
  let resolveShell!: () => void;
  const allReady = new Promise<void>((resolve, reject) => {
    rejectAll = reject;
    resolveAll = resolve;
  });
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
    onShellError: (error) => {
      const shellError = error instanceof Error ? error : new Error(String(error));

      hasShellSettled = true;
      rejectAll(shellError);
      rejectShell(shellError);
    },
    onShellReady: () => {
      hasShellSettled = true;
      resolveShell();
    },
  });
  const abort = (reason?: unknown): void => {
    if (hasAborted) {
      return;
    }

    hasAborted = true;

    // React 18 may omit shell callbacks when the root task is aborted.
    if (!hasShellSettled) {
      hasShellSettled = true;
      const error =
        reason instanceof Error
          ? reason
          : new Error(typeof reason === 'string' ? reason : 'Render aborted');

      rejectShell(error);
      rejectAll(error);
    }

    rendered.abort(reason);
  };
  const onAbort = (): void => abort(options.signal.reason);
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
