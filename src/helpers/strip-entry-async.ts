import path from 'node:path';
import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

type TNode = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document;

/**
 * Pathname a src resolves to from a directory, without query and fragment, as the browser reads
 * it: surrounding ASCII whitespace dropped, a relative src under the directory.
 * A src naming another host or scheme, or climbing with `..`, is never the entry.
 */
const getSrcPath = (src: string, directory: string): string | undefined => {
  const [pathname] = src.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').split(/[?#]/, 1);

  if (
    /^[a-z][a-z\d+.-]*:/i.test(pathname) ||
    /^[\\/]{2}/.test(pathname) ||
    pathname.includes('\\') ||
    pathname.split('/').includes('..')
  ) {
    return undefined;
  }

  return path.posix.normalize(pathname.startsWith('/') ? pathname : `${directory}/${pathname}`);
};

/**
 * Directory of a resolved pathname: the path itself when it ends with a slash.
 */
const getDirectory = (pathname: string): string =>
  pathname.endsWith('/') ? pathname : path.posix.dirname(pathname);

/**
 * Find the first base element with an href, which the browser resolves every src against.
 */
const findBaseHref = (node: TNode): string | undefined => {
  if ('tagName' in node && node.tagName === 'base') {
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
  directory: string,
  ranges: [number, number][],
): void => {
  if ('tagName' in node && node.tagName === 'script') {
    const src = node.attrs.find(({ name }) => name === 'src');
    const location = node.sourceCodeLocation?.attrs?.async;

    if (src?.value && location && getSrcPath(src.value, directory) === entryPath) {
      ranges.push([location.startOffset, location.endOffset]);
    }
  }

  if ('childNodes' in node) {
    node.childNodes.forEach((child) => collectAsyncRanges(child, entryPath, directory, ranges));
  }
};

/**
 * Remove async from the client entry script, so plugin preambles run before it.
 * The entry is found by the exact pathname its src resolves to from the document URL, or from
 * the base element, as the HTML parser reads the document.
 */
const stripEntryAsync = (
  html: string,
  base: string | undefined,
  clientFile: string,
  documentUrl = '/',
): string => {
  const entryPath = path.posix.normalize(`/${base ?? '/'}/${clientFile}`);
  const document = parse(html, { sourceCodeLocationInfo: true });
  const documentPath = getSrcPath(documentUrl, '/') ?? '/';
  const baseHref = findBaseHref(document);
  const basePath =
    baseHref === undefined ? documentPath : getSrcPath(baseHref, getDirectory(documentPath));
  const ranges: [number, number][] = [];

  // A base element for another host or scheme sends every src there, so none is the entry.
  if (basePath === undefined) {
    return html;
  }

  collectAsyncRanges(document, entryPath, getDirectory(basePath), ranges);

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
