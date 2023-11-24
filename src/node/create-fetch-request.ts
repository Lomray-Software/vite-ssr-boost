import type { Request as ExpressRequest } from 'express';

/**
 * Convert the incoming Express request into a Fetch request, which is what the static handler methods operate on.
 * @see https://reactrouter.com/en/main/guides/ssr
 */
function createFetchRequest(req: ExpressRequest): Request {
  const origin = `${req.protocol}://${req.get('host') as string}`;
  // Note: This had to take originalUrl into account for presumably vite's proxying
  const url = new URL(req.originalUrl || req.url, origin);
  const controller = new AbortController();

  req.on('close', () => controller.abort());

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

  const init = {
    method: req.method,
    headers,
    signal: controller.signal,
    body: undefined,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
  }

  return new Request(url.href, init);
}

export default createFetchRequest;
