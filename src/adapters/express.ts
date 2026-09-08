import type { NextFunction, Request, RequestHandler, Response as ExpressResponse } from 'express';
import serializeBody from '@adapters/body';
import createFetchRequest from '@adapters/express/create-request';
import { handleRequest } from '@adapters/node';
import type { INodeAdapterOptions } from '@adapters/node';
import type { TSsrHandler } from '@core/types';
import createRequestSignal from '@node/request-signal';

export interface IExpressAdapterOptions extends INodeAdapterOptions {
  getBody?: (request: Request) => BodyInit | null | undefined;
}

/**
 * Bridge Express middleware to Fetch while retaining parsed body support.
 */
const adapterExpress = (
  handler: TSsrHandler,
  options: IExpressAdapterOptions = {},
): RequestHandler => {
  /**
   * Preserve Express routing semantics and dispose request listeners on completion.
   */
  return (req: Request, res: ExpressResponse, next: NextFunction): void => {
    const requestSignal = createRequestSignal(req, res);

    /**
     * Forward failures only while the client connection is still active.
     */
    const onError = (error: unknown): void => {
      if (!requestSignal.signal.aborted) {
        next(error);
      }
    };

    try {
      const requestOptions: { body?: BodyInit | null; signal: AbortSignal } = {
        signal: requestSignal.signal,
      };

      if (options.getBody) {
        requestOptions.body = options.getBody(req) ?? null;
      } else if (req.body !== undefined) {
        requestOptions.body = serializeBody(req.body, req.get('Content-Type'));
      }

      void handleRequest(handler, createFetchRequest(req, requestOptions), res, {
        compression: options.compression,
      })
        .catch(onError)
        .finally(requestSignal.dispose);
    } catch (error) {
      try {
        onError(error);
      } finally {
        requestSignal.dispose();
      }
    }
  };
};

export default adapterExpress;
