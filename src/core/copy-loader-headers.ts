import type { StaticHandlerContext } from 'react-router';
import { getHeaderEntries, getSetCookieHeaders } from '@core/headers';

/**
 * Copy only named fields, visiting matched routes root to leaf, loader before action.
 * The first ordinary value wins (including Cache-Control); all cookies are appended.
 */
const copyLoaderHeaders = (
  routerContext: Pick<StaticHandlerContext, 'matches' | 'loaderHeaders' | 'actionHeaders'>,
  { allow }: { allow: readonly string[] },
): Headers => {
  const headers = new Headers();
  const allowed = new Set(allow.map((name) => name.toLowerCase()));

  allowed.delete('content-type');

  for (const { route } of routerContext.matches) {
    for (const source of [
      routerContext.loaderHeaders[route.id],
      routerContext.actionHeaders[route.id],
    ]) {
      if (!source) {
        continue;
      }

      getHeaderEntries(source).forEach(([name, value]) => {
        if (allowed.has(name.toLowerCase()) && !headers.has(name)) {
          headers.set(name, value);
        }
      });

      if (allowed.has('set-cookie')) {
        getSetCookieHeaders(source).forEach((cookie) => headers.append('Set-Cookie', cookie));
      }
    }
  }

  return headers;
};

export default copyLoaderHeaders;
