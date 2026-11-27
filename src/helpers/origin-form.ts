/**
 * Origin-form target of a request: an absolute-form target (`GET http://host/path`) keeps only
 * its path and query, so every handler reads the same path. Undefined when the target is
 * neither form, which leaves the request to the next handler.
 */
const getOriginForm = (url: string): string | undefined => {
  if (url.startsWith('/')) {
    return url;
  }

  try {
    const { protocol, pathname, search } = new URL(url);

    return protocol === 'http:' || protocol === 'https:' ? `${pathname}${search}` : undefined;
  } catch {
    return undefined;
  }
};

export default getOriginForm;
