import type { Request as ExpressRequest } from 'express';
import serializeBody from '@adapters/body';

interface ICreateFetchRequestOptions {
  body?: BodyInit | null;
  signal?: AbortSignal;
}

/**
 * Convert the incoming Express request into a Fetch request, which is what the static handler methods operate on.
 * @see https://reactrouter.com/en/main/guides/ssr
 */
function createFetchRequest(
  req: ExpressRequest,
  options: ICreateFetchRequestOptions = {},
): Request {
  const { body, signal } = options;
  const origin = `${req.protocol}://${req.get('host') as string}`;
  // Note: This had to take originalUrl into account for presumably vite's proxying
  const url = new URL(req.originalUrl || req.url, origin);
  const headers = new Headers();

  for (const [key, values] of Object.entries(req.headers)) {
    if (values) {
      if (Array.isArray(values)) {
        for (const value of values) {
          headers.append(key, value);
        }
      } else {
        headers.set(key, values);
      }
    }
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    signal,
    body: undefined,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const hasExplicitBody = Object.hasOwn(options, 'body');
    const hasParsedBody = req.body !== undefined;

    if (hasExplicitBody || hasParsedBody) {
      headers.delete('Content-Length');
    }

    if (hasExplicitBody) {
      init.body = body;
    } else if (hasParsedBody) {
      init.body = serializeBody(req.body, req.get('Content-Type'));
    } else {
      init.body = req as unknown as BodyInit;
    }

    init.duplex = 'half';
  }

  return new Request(url.href, init);
}

export type { ICreateFetchRequestOptions };

export default createFetchRequest;
