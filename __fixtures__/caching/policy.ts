import { cacheControl } from '@lomray/vite-ssr-boost/http';
import type { IDocumentHeaderRule } from '@lomray/vite-ssr-boost/http';

export const sessionCookie = 'session';
export const freshSeconds = 30;
export const staleSeconds = 60;
export const guestPolicy = cacheControl({
  public: true,
  maxAge: freshSeconds,
  staleWhileRevalidate: staleSeconds,
});
// Use this alternative when shared-cache freshness differs and stale serving is unnecessary.
export const sharedPolicy = cacheControl({ public: true, maxAge: 0, sMaxAge: 30 });
export const rules: IDocumentHeaderRule[] = [
  { when: () => true, set: { 'Cache-Control': cacheControl({ private: true, noStore: true }) } },
  {
    when: ({ request, url }) =>
      ['GET', 'HEAD'].includes(request.method) && url.pathname === '/guest',
    set: { 'Cache-Control': guestPolicy },
  },
];
