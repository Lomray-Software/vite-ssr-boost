import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TCompression } from '@adapters/compression';
import type { TSsrHandler } from '@core/types';
import compressResponse from '@node/compress-response';
import createRequest from '@node/create-request';
import createRequestSignal from '@node/request-signal';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse from '@node/write-fetch-response';

type TNext = (error?: unknown) => void;
type TNodeHandler = (req: IncomingMessage, res: ServerResponse, next?: TNext) => Promise<void>;

export interface INodeAdapterOptions {
  compression?: TCompression;
}

const handleRequest = async (
  handler: TSsrHandler,
  request: Request,
  res: ServerResponse,
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

const adapterNode = (handler: TSsrHandler, options: INodeAdapterOptions = {}): TNodeHandler => {
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
