import { cacheControl, conditionalRequest } from '@lomray/vite-ssr-boost/http';

/** A public, existing representation whose version includes every output dependency. */
export const bufferedPage = (request: Request): Response => {
  const html = '<!doctype html><main>Published article revision 7</main>';
  const validators = {
    etag: 'W/"article-7-template-2"',
    lastModified: 'Tue, 01 Sep 2026 12:00:00 GMT',
  };
  const headers = new Headers({
    'Cache-Control': cacheControl({ public: true, maxAge: 30 }),
    'Content-Type': 'text/html',
    ETag: validators.etag,
    'Last-Modified': validators.lastModified,
  });
  const unchanged = conditionalRequest(request, validators);

  if (unchanged) {
    // A 304 must retain the cache policy and any Vary/Content-Location of the 200.
    unchanged.headers.set('Cache-Control', headers.get('Cache-Control')!);

    return unchanged;
  }

  return new Response(request.method === 'HEAD' ? null : html, { headers });
};
