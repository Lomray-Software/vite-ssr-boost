import type { IncomingMessage } from 'node:http';

interface ICreateRequestOptions {
  body?: BodyInit | null;
  origin?: string;
  signal?: AbortSignal;
}

const createRequest = (req: IncomingMessage, options: ICreateRequestOptions = {}): Request => {
  const { body, origin, signal } = options;
  const headers = new Headers();

  for (const [name, values] of Object.entries(req.headers)) {
    if (Array.isArray(values)) {
      values.forEach((value) => headers.append(name, value));
    } else if (values !== undefined) {
      headers.set(name, values);
    }
  }

  const protocol = 'encrypted' in req.socket && req.socket.encrypted ? 'https' : 'http';
  const url = new URL(req.url ?? '/', origin ?? `${protocol}://${headers.get('host')}`);
  const init: RequestInit & { duplex?: 'half' } = {
    headers,
    method: req.method,
    signal,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = 'body' in options ? body : (req as unknown as BodyInit);
    init.duplex = 'half';
  }

  return new Request(url, init);
};

export type { ICreateRequestOptions };

export default createRequest;
