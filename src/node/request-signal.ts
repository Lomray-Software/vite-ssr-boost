import type { IncomingMessage, ServerResponse } from 'node:http';

interface IRequestSignal {
  dispose: () => void;
  signal: AbortSignal;
}

const createRequestSignal = (req: IncomingMessage, res: ServerResponse): IRequestSignal => {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const onClose = (): void => {
    if (!res.writableEnded) {
      abort();
    }
  };
  const dispose = (): void => {
    req.off('aborted', abort);
    res.off('close', onClose);
  };

  req.once('aborted', abort);
  res.once('close', onClose);

  if (req.aborted || res.destroyed) {
    abort();
  }

  return { dispose, signal: controller.signal };
};

export default createRequestSignal;
