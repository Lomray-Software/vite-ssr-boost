import path from 'node:path';
import { html as htmlSpec, parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

type TNode = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document;

/**
 * Origin the document, base and src URLs are resolved against; the reserved TLD never resolves.
 */
const ORIGIN = 'http://document.invalid';

/**
 * Prepare an attribute URL as the URL parser does: trim C0 controls and spaces at both ends and
 * drop every ASCII tab or newline, so the scheme and host checks see the URL the browser parses.
 */
const normalizeUrl = (value: string): string => {
  let start = 0;
  let end = value.length;

  while (start < end && value.charCodeAt(start) <= 0x20) {
    start += 1;
  }

  while (end > start && value.charCodeAt(end - 1) <= 0x20) {
    end -= 1;
  }

  return value.slice(start, end).replace(/[\t\n\r]/g, '');
};

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
  const value = normalizeUrl(src);
  const url = isForeignSrc(value) ? undefined : parseUrl(value, base);

  return url?.origin === base.origin ? url.pathname : undefined;
};

/**
 * Base a script after this base element resolves against: the document URL when the href does
 * not parse or is a data or javascript URL, as in the browser, or none when it names another
 * scheme or a host, which sends every src away from the entry.
 */
const resolveBase = (href: string, documentBase: URL): URL | undefined => {
  const value = normalizeUrl(href);
  const url = parseUrl(value, documentBase);

  // Such a base never becomes the document base; the document URL stays in effect.
  if (!url || /^(data|javascript):$/.test(url.protocol)) {
    return documentBase;
  }

  return hasSchemeOrHost(value) || url.origin !== documentBase.origin ? undefined : url;
};

type TElement = DefaultTreeAdapterTypes.Element;

/**
 * Collect the HTML base and script elements under a node. A base or a script inside SVG or
 * MathML is foreign content, and template contents are inert, so neither is collected.
 */
const collectElements = (node: TNode, elements: TElement[]): void => {
  if (
    'tagName' in node &&
    node.namespaceURI === htmlSpec.NS.HTML &&
    (node.tagName === 'base' || node.tagName === 'script')
  ) {
    elements.push(node);
  }

  if ('childNodes' in node) {
    node.childNodes.forEach((child) => collectElements(child, elements));
  }
};

/**
 * Offset in the source where an element starts.
 */
const getStartOffset = (element: TElement): number => element.sourceCodeLocation?.startOffset ?? 0;

/**
 * Source ranges of async attributes on HTML scripts whose src is the entry. The browser fetches
 * a script against the base in effect when the parser reaches it: the first HTML base element
 * with an href in tree order among those inserted so far, or the document URL before any. Elements
 * are taken in source order, since the tree builder can move a base, out of a table for one, ahead
 * of an earlier script or an earlier base.
 */
const collectAsyncRanges = (
  document: DefaultTreeAdapterTypes.Document,
  entryPath: string,
  documentBase: URL,
): [number, number][] => {
  const elements: TElement[] = [];
  const ranges: [number, number][] = [];
  let base: URL | undefined = documentBase;
  let baseIndex = Infinity;

  collectElements(document, elements);
  elements
    .map((element, index) => ({ element, index }))
    .sort((left, right) => getStartOffset(left.element) - getStartOffset(right.element))
    .forEach(({ element, index }) => {
      const href = element.tagName === 'base' && element.attrs.find(({ name }) => name === 'href');

      if (href && index < baseIndex) {
        baseIndex = index;
        base = resolveBase(href.value, documentBase);
      }

      if (element.tagName !== 'script' || !base) {
        return;
      }

      const src = element.attrs.find(({ name }) => name === 'src');
      const location = element.sourceCodeLocation?.attrs?.async;

      if (src?.value && location && getSrcPath(src.value, base) === entryPath) {
        ranges.push([location.startOffset, location.endOffset]);
      }
    });

  return ranges;
};

/**
 * Remove async from the client entry script, so plugin preambles run before it.
 * The entry is found by the exact pathname its src resolves to, with the URL rules the browser
 * applies, from the document URL or the base element in effect for that script.
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
  const ranges = collectAsyncRanges(document, entryPath, documentBase);

  if (!ranges.length) {
    return html;
  }

  // Cut by position from the end, together with the whitespace before each attribute.
  const result = ranges
    .sort(([left], [right]) => right - left)
    .reduce((text, [start, end]) => {
      const rest = text.slice(end);
      // Only HTML whitespace separates attributes; a no-break space belongs to the value before.
      const head = text.slice(0, start).replace(/[\t\n\f\r ]+$/, '');

      // Another attribute or a slash right after the cut would join the token before it, so one
      // space stays unless whitespace or the end of the tag follows.
      return `${head}${/^[^\t\n\f\r >]/.test(rest) ? ' ' : ''}${rest}`;
    }, html);

  // The parser reports only the first of repeated attributes, so a repeated async needs a pass.
  return stripEntryAsync(result, base, clientFile, documentUrl);
};

export default stripEntryAsync;
