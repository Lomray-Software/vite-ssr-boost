import renderToStream from '@lomray/vite-ssr-boost/edge/render-to-stream';
import { createPageHandler } from './app';
import { createGuestCache } from './guest-cache';

const origin = createPageHandler(renderToStream);
let cached: ReturnType<typeof createGuestCache> | undefined;

export default {
  fetch(
    request: Request,
    _env: unknown,
    context: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    cached ??= createGuestCache(origin, (caches as CacheStorage & { default: Cache }).default);

    return cached(request, context);
  },
};
