import type { TCompression } from '@adapters/compression';
import type { TSsrHandler } from '@core/types';
import compressResponse from '@node/compress-response';
import createRequest from '@node/create-request';
import type { TIncomingMessage, TServerResponse } from '@node/http';
import createRequestSignal from '@node/request-signal';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse from '@node/write-fetch-response';

type TNext = (error?: unknown) => void;
type TNodeHandler = (req: TIncomingMessage, res: TServerResponse, next?: TNext) => Promise<void>;

export interface INodeAdapterOptions {
  compression?: TCompression;
}

/**
 * Render and write a Fetch response using the Node transport.
 */
const handleRequest = async (
  handler: TSsrHandler,
  request: Request,
  res: TServerResponse,
  { compression = false }: INodeAdapterOptions = {},
): Promise<void> => {
  const response = compressResponse(
    request,
    await handler(request, {
      onEarlyHints: (headers) => writeEarlyHints(res, headers),
    }),
    compression,
  );

  await writeFetchResponse(res, response);
};

/**
 * Connect Node requests to the Fetch handler and dispose disconnect listeners.
 */
const adapterNode = (handler: TSsrHandler, options: INodeAdapterOptions = {}): TNodeHandler => {
  /**
   * Scope disconnect handling to the lifetime of this Node request.
   */
  return async (req, res, next) => {
    const requestSignal = createRequestSignal(req, res);

    try {
      await handleRequest(
        handler,
        createRequest(req, { signal: requestSignal.signal }),
        res,
        options,
      );
    } catch (error) {
      if (requestSignal.signal.aborted) {
        return;
      }

      if (next) {
        next(error);
      } else if (res.headersSent) {
        res.destroy(error as Error);
      } else {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    } finally {
      requestSignal.dispose();
    }
  };
};

export type { TNodeHandler };

export { handleRequest };

export default adapterNode;
