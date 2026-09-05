import type { TIncomingMessage, TServerResponse } from '@node/http';

interface IRequestSignal {
  dispose: () => void;
  signal: AbortSignal;
}

/**
 * Expose incomplete Node requests and disconnected responses as an AbortSignal.
 */
const createRequestSignal = (req: TIncomingMessage, res: TServerResponse): IRequestSignal => {
  const controller = new AbortController();

  /**
   * Cancel downstream work when the incoming request is aborted.
   */
  const abort = (): void => controller.abort();

  /**
   * Distinguish an interrupted response from normal completion.
   */
  const onClose = (): void => {
    if (!res.writableEnded) {
      abort();
    }
  };

  /**
   * Remove transport listeners after the handler finishes.
   */
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
