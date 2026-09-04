import type { Request as ExpressRequest } from 'express';
import serializeBody from '@adapters/body';
import createRequest from '@node/create-request';
import type { ICreateRequestOptions } from '@node/create-request';

interface ICreateFetchRequestOptions {
  body?: BodyInit | null;
  signal?: AbortSignal;
}

/** Preserve Express's trusted protocol and original URL when creating the router request. */
function createFetchRequest(
  req: ExpressRequest,
  options: ICreateFetchRequestOptions = {},
): Request {
  const requestOptions: ICreateRequestOptions = {
    ...options,
    origin: `${req.protocol}://${req.get('host') as string}`,
    url: req.originalUrl || req.url,
  };

  if (
    !Object.hasOwn(options, 'body') &&
    req.body !== undefined &&
    req.method !== 'GET' &&
    req.method !== 'HEAD'
  ) {
    requestOptions.body = serializeBody(req.body, req.get('Content-Type'));
  }

  return createRequest(req, requestOptions);
}

export type { ICreateFetchRequestOptions };

export default createFetchRequest;
