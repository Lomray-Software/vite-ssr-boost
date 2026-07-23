import { PassThrough, Readable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import type { TRenderToStream } from '@core/render';

const renderToStream: TRenderToStream = (node, options) => {
  const destination = new PassThrough();
  const stream = Readable.toWeb(destination) as ReadableStream<Uint8Array>;
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

  const rendered = renderToPipeableStream(node, {
    onAllReady: resolveAll,
    onError: options.onError,
    onShellError: (error) => {
      const shellError = error instanceof Error ? error : new Error(String(error));

      rejectAll(shellError);
      rejectShell(shellError);
    },
    onShellReady: resolveShell,
  });
  let hasStarted = false;

  return {
    allReady,
    abort: rendered.abort,
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
