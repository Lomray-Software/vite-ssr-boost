import type { NextFunction, Request, RequestHandler, Response as ExpressResponse } from 'express';
import { handleRequest } from '@adapters/node';
import type { TSsrHandler } from '@core/types';
import createFetchRequest from '@node/create-fetch-request';

const adapterExpress = (handler: TSsrHandler): RequestHandler => {
  return (req: Request, res: ExpressResponse, next: NextFunction): void => {
    void handleRequest(handler, createFetchRequest(req), res).catch(next);
  };
};

export default adapterExpress;
