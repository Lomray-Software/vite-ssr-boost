import type { TSsrHandler } from '@lomray/vite-ssr-boost/core/types';
import { freshSeconds, guestPolicy, staleSeconds } from './policy';

interface IBackgroundContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

/** URL-only, bounded SWR cache for the /guest representation in app.tsx. */
export const createGuestCache = (
  origin: TSsrHandler,
  cache: Pick<Cache, 'match' | 'put' | 'delete'>,
  now: () => number = Date.now,
) => {
  const refreshing = new Map<string, Promise<void>>();
  const storedAt = 'X-Guest-Cache-Stored-At';

  return async (request: Request, context: IBackgroundContext): Promise<Response> => {
    const url = new URL(request.url);
    const cookie = request.headers.get('Cookie') ?? '';

    if (
      request.method !== 'GET' ||
      url.pathname !== '/guest' ||
      /(?:^|;)\s*session\s*=/.test(cookie) ||
      [
        'Authorization',
        'Range',
        'If-None-Match',
        'If-Modified-Since',
        'Cache-Control',
        'Pragma',
      ].some((name) => request.headers.has(name))
    ) {
      return origin(request);
    }

    // Query strings stay in the key. Guest output must depend only on this URL.
    url.hash = '';
    const key = new Request(url, { method: 'GET' });
    const cached = await cache.match(key);
    const timestamp = Number(cached?.headers.get(storedAt) ?? NaN);
    const age = Math.max(0, Math.floor((now() - timestamp) / 1000));

    const refresh = async (): Promise<Response> => {
      // Drop unkeyed cookies and headers before rendering the shared representation.
      const response = await origin(new Request(url, { headers: { Accept: 'text/html' } }));

      if (
        response.status === 200 &&
        response.headers.get('Cache-Control') === guestPolicy &&
        !response.headers.has('Set-Cookie') &&
        !response.headers.has('Vary')
      ) {
        const stored = new Response(response.clone().body, response);

        stored.headers.set(storedAt, String(now()));
        // Cache API has no native SWR: retain the body for the entire bounded window.
        stored.headers.set('Cache-Control', `public, max-age=${freshSeconds + staleSeconds}`);
        await cache.put(key, stored);
      } else {
        await cache.delete(key);
      }

      return response;
    };

    if (cached && Number.isFinite(timestamp) && age < freshSeconds + staleSeconds) {
      if (age >= freshSeconds && !refreshing.has(url.href)) {
        const pending = refresh()
          .then((response) => response.body?.cancel())
          .catch(() => undefined)
          .finally(() => refreshing.delete(url.href));

        refreshing.set(url.href, pending);
        context.waitUntil(pending);
      }

      const response = new Response(cached.body, cached);

      response.headers.delete(storedAt);
      response.headers.set('Cache-Control', guestPolicy);
      response.headers.set('Age', String(age));

      return response;
    }

    // A tee's cancellation can wait for the cache's retained branch; do not block refresh.
    void cached?.body?.cancel().catch(() => undefined);

    return refresh();
  };
};
