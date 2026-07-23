import { PassThrough, Readable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import type { TRenderToStream } from '@core/render';

const renderToStream: TRenderToStream = (node, options) => {
  const destination = new PassThrough();
  const stream = Readable.toWeb(destination) as ReadableStream<Uint8Array>;
  const rendered = renderToPipeableStream(node, options);
  let hasStarted = false;

  return {
    abort: rendered.abort,
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
