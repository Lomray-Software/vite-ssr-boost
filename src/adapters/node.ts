import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TSsrHandler } from '@core/types';
import createRequest from '@node/create-request';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse from '@node/write-fetch-response';

type TNext = (error?: unknown) => void;
type TNodeHandler = (req: IncomingMessage, res: ServerResponse, next?: TNext) => Promise<void>;

const handleRequest = async (
  handler: TSsrHandler,
  request: Request,
  res: ServerResponse,
): Promise<void> => {
  const response = await handler(request, {
    onEarlyHints: (headers) => writeEarlyHints(res, headers),
  });

  await writeFetchResponse(res, response);
};

const adapterNode = (handler: TSsrHandler): TNodeHandler => {
  return async (req, res, next) => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    const onClose = (): void => {
      if (!res.writableEnded) {
        abort();
      }
    };

    req.once('aborted', abort);
    res.once('close', onClose);

    try {
      await handleRequest(handler, createRequest(req, { signal: controller.signal }), res);
    } catch (error) {
      if (next) {
        next(error);
      } else if (res.headersSent) {
        res.destroy(error as Error);
      } else {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    } finally {
      req.off('aborted', abort);
      res.off('close', onClose);
    }
  };
};

export type { TNodeHandler };

export { handleRequest };

export default adapterNode;
