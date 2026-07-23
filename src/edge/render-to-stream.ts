import { renderToReadableStream } from 'react-dom/server.browser';
import type { TRenderToStream } from '@core/render';

const renderToStream: TRenderToStream = async (node, { onError, signal }) => {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal.reason);

  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }

  const stream = await renderToReadableStream(node, {
    onError,
    signal: controller.signal,
  });

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
