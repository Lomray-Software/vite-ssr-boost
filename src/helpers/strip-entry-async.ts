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
 * not parse, as in the browser, or none when it names a scheme or a host, which sends every src
 * away from the entry.
 */
const resolveBase = (href: string, documentBase: URL): URL | undefined => {
  const value = normalizeUrl(href);
  const url = parseUrl(value, documentBase);

  if (!url) {
    return documentBase;
  }

  return hasSchemeOrHost(value) || url.origin !== documentBase.origin ? undefined : url;
};

interface IScanState {
  /** The base the next script resolves against; undefined when no later script is the entry. */
  base: URL | undefined;
  /** Whether the first HTML base element with an href was reached. */
  hasBase: boolean;
}

/**
 * Collect, in document order, the source ranges of async attributes on HTML scripts whose src
 * is the entry. The browser fetches a script against the base in effect when the parser reaches
 * it: the document URL before the first HTML base element with an href, that base after it.
 * A base or a script inside SVG or MathML is foreign content and ignored.
 */
const collectAsyncRanges = (
  node: TNode,
  entryPath: string,
  documentBase: URL,
  state: IScanState,
  ranges: [number, number][],
): void => {
  if ('tagName' in node && node.namespaceURI === htmlSpec.NS.HTML) {
    const href = node.tagName === 'base' && node.attrs.find(({ name }) => name === 'href');

    if (href && !state.hasBase) {
      state.hasBase = true;
      state.base = resolveBase(href.value, documentBase);
    }

    if (node.tagName === 'script' && state.base) {
      const src = node.attrs.find(({ name }) => name === 'src');
      const location = node.sourceCodeLocation?.attrs?.async;

      if (src?.value && location && getSrcPath(src.value, state.base) === entryPath) {
        ranges.push([location.startOffset, location.endOffset]);
      }
    }
  }

  if ('childNodes' in node) {
    node.childNodes.forEach((child) =>
      collectAsyncRanges(child, entryPath, documentBase, state, ranges),
    );
  }
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
  const ranges: [number, number][] = [];

  collectAsyncRanges(
    document,
    entryPath,
    documentBase,
    { base: documentBase, hasBase: false },
    ranges,
  );

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
