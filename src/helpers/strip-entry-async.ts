import path from 'node:path';
import { html as htmlSpec, parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

type TNode = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document;

/**
 * Origin the document, base and src URLs are resolved against; the reserved TLD never resolves.
 */
const ORIGIN = 'http://document.invalid';

/**
 * Drop the ASCII whitespace the browser trims around an attribute URL.
 */
const trimUrl = (value: string): string => value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');

/**
 * Parse a URL against a base as the browser does, or undefined when it does not parse.
 */
const parseUrl = (value: string, base?: URL | string): URL | undefined => {
  try {
    return new URL(value, base);
  } catch {
    return undefined;
  }
};

/**
 * Whether a URL names a scheme or a host of its own.
 */
const hasSchemeOrHost = (value: string): boolean =>
  /^[a-z][a-z\d+.-]*:/i.test(value) || /^[\\/]{2}/.test(value);

/**
 * Whether a src names a scheme or another host, contains a backslash or climbs with a dot
 * segment. Such a src is never the entry.
 */
const isForeignSrc = (src: string): boolean => {
  const [pathname] = src.split(/[?#]/, 1);

  return (
    hasSchemeOrHost(pathname) ||
    pathname.includes('\\') ||
    pathname.split('/').some((segment) => /^(\.|%2e){2}$/i.test(segment))
  );
};

/**
 * Pathname a src resolves to from the base URL with the browser URL rules, query and fragment
 * ignored and empty segments kept.
 */
const getSrcPath = (src: string, base: URL): string | undefined => {
  const value = trimUrl(src);
  const url = isForeignSrc(value) ? undefined : parseUrl(value, base);

  return url?.origin === base.origin ? url.pathname : undefined;
};

/**
 * Find the first HTML base element with an href, which the browser resolves every src against.
 * A base inside SVG or MathML is foreign content and sets no document base.
 */
const findBaseHref = (node: TNode): string | undefined => {
  if ('tagName' in node && node.tagName === 'base' && node.namespaceURI === htmlSpec.NS.HTML) {
    const href = node.attrs.find(({ name }) => name === 'href');

    if (href) {
      return href.value;
    }
  }

  if ('childNodes' in node) {
    for (const child of node.childNodes) {
      const href = findBaseHref(child);

      if (href !== undefined) {
        return href;
      }
    }
  }

  return undefined;
};

/**
 * Collect the source ranges of async attributes on scripts whose src is the entry.
 */
const collectAsyncRanges = (
  node: TNode,
  entryPath: string,
  base: URL,
  ranges: [number, number][],
): void => {
  if ('tagName' in node && node.tagName === 'script') {
    const src = node.attrs.find(({ name }) => name === 'src');
    const location = node.sourceCodeLocation?.attrs?.async;

    if (src?.value && location && getSrcPath(src.value, base) === entryPath) {
      ranges.push([location.startOffset, location.endOffset]);
    }
  }

  if ('childNodes' in node) {
    node.childNodes.forEach((child) => collectAsyncRanges(child, entryPath, base, ranges));
  }
};

/**
 * Remove async from the client entry script, so plugin preambles run before it.
 * The entry is found by the exact pathname its src resolves to from the document URL, or from
 * the base element, with the URL rules the browser applies.
 */
const stripEntryAsync = (
  html: string,
  base: string | undefined,
  clientFile: string,
  documentUrl = '/',
): string => {
  const entryPath = new URL(path.posix.normalize(`/${base ?? '/'}/${clientFile}`), ORIGIN).pathname;
  const document = parse(html, { sourceCodeLocationInfo: true });
  // The request target is a path on this origin, even when it starts with two slashes.
  const documentBase =
    (documentUrl.startsWith('/') && parseUrl(`${ORIGIN}${documentUrl}`)) || new URL('/', ORIGIN);
  const baseHref = findBaseHref(document);
  const baseValue = baseHref === undefined ? undefined : trimUrl(baseHref);
  // A base href that does not parse leaves the document URL as the base, as in the browser.
  const baseUrl =
    baseValue === undefined ? documentBase : (parseUrl(baseValue, documentBase) ?? documentBase);
  const ranges: [number, number][] = [];

  // A base element with a scheme or a host sends every src there, so none is the entry.
  if (
    (baseValue !== undefined && hasSchemeOrHost(baseValue)) ||
    baseUrl.origin !== documentBase.origin
  ) {
    return html;
  }

  collectAsyncRanges(document, entryPath, baseUrl, ranges);

  if (!ranges.length) {
    return html;
  }

  // Cut by position from the end, together with the whitespace before each attribute.
  const result = ranges
    .sort(([left], [right]) => right - left)
    .reduce(
      // Only HTML whitespace separates attributes; a no-break space belongs to the value before.
      (text, [start, end]) => text.slice(0, start).replace(/[\t\n\f\r ]+$/, '') + text.slice(end),
      html,
    );

  // The parser reports only the first of repeated attributes, so a repeated async needs a pass.
  return stripEntryAsync(result, base, clientFile, documentUrl);
};

export default stripEntryAsync;
