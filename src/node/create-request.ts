import createHeaders from '@node/create-headers';
import type { TIncomingMessage } from '@node/http';

interface ICreateRequestOptions {
  body?: BodyInit | null;
  origin?: string;
  signal?: AbortSignal;
  url?: string;
}

/**
 * Preserve the Node request URL, body and cancellation signal for Fetch handlers.
 */
const createRequest = (req: TIncomingMessage, options: ICreateRequestOptions = {}): Request => {
  const { body, origin, signal } = options;
  const headers = createHeaders(req.headers);
  const protocol =
    req.socket && 'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http';
  const authority = req.headers[':authority'];
  const host = headers.get('host') ?? (typeof authority === 'string' ? authority : null);
  const requestOrigin = new URL(origin ?? `${protocol}://${host}`).origin;
  const target = options.url ?? req.url ?? '/';

  /**
   * An origin-form target beginning with // is a path, not a replacement hostname.
   */
  const url = new URL(target.startsWith('/') ? requestOrigin + target : target, requestOrigin);
  const init: RequestInit & { duplex?: 'half' } = {
    headers,
    method: req.method,
    signal,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if ('body' in options) {
      headers.delete('Content-Length');

      if (body instanceof FormData) {
        /**
         * Fetch must generate the boundary for a newly serialized multipart body.
         */
        headers.delete('Content-Type');
      }

      init.body = body;
    } else {
      init.body = req as unknown as BodyInit;
    }

    init.duplex = 'half';
  }

  return new Request(url, init);
};

export type { ICreateRequestOptions };

export default createRequest;
