/**
 * Scheme and authority of an absolute-form target, up to the first character that ends the
 * authority. A backslash ends it too, since the URL parser reads it as a path separator.
 */
const ABSOLUTE_FORM_PREFIX = /^https?:\/\/[^/?#\\]+/i;

/**
 * Origin-form target of a request: an absolute-form target (`GET http://host/path`) keeps only
 * its path and query, written as the client sent them, so every handler reads the same path as
 * for the origin form. Undefined when the target is neither form, or when its path starts with a
 * backslash, which leaves the request to the next handler.
 */
const getOriginForm = (url: string): string | undefined => {
  if (url.startsWith('/')) {
    return url;
  }

  try {
    const { protocol } = new URL(url);

    if (protocol !== 'http:' && protocol !== 'https:') {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const prefix = ABSOLUTE_FORM_PREFIX.exec(url)?.[0];

  if (prefix === undefined) {
    return undefined;
  }

  // The path is not resolved here: `..` and `.` segments stay as in the origin form.
  const rest = url.slice(prefix.length);

  if (rest === '') {
    return '/';
  }

  if (rest.startsWith('?') || rest.startsWith('#')) {
    return `/${rest}`;
  }

  return rest.startsWith('/') ? rest : undefined;
};

export default getOriginForm;
