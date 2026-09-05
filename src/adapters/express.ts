import type { NextFunction, Request, RequestHandler, Response as ExpressResponse } from 'express';
import serializeBody from '@adapters/body';
import { handleRequest } from '@adapters/node';
import type { INodeAdapterOptions } from '@adapters/node';
import type { TSsrHandler } from '@core/types';
import createFetchRequest from '@node/create-fetch-request';
import createRequestSignal from '@node/request-signal';

export interface IExpressAdapterOptions extends INodeAdapterOptions {
  getBody?: (request: Request) => BodyInit | null | undefined;
}

const adapterExpress = (
  handler: TSsrHandler,
  options: IExpressAdapterOptions = {},
): RequestHandler => {
  return (req: Request, res: ExpressResponse, next: NextFunction): void => {
    const requestSignal = createRequestSignal(req, res);
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
      requestSignal.dispose();
      onError(error);
    }
  };
};

export default adapterExpress;
