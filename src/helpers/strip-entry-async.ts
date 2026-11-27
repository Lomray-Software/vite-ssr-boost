import path from 'node:path';
import { parse } from 'parse5';
import type { DefaultTreeAdapterTypes } from 'parse5';

type TNode = DefaultTreeAdapterTypes.ChildNode | DefaultTreeAdapterTypes.Document;

/**
 * Pathname of a script src without query and fragment, normalized with one leading slash.
 */
const getSrcPath = (src: string): string =>
  path.posix.normalize(`/${src.split(/[?#]/, 1)[0].replace(/^\/+/, '')}`);

/**
 * Collect the source ranges of async attributes on scripts whose src is the entry.
 */
const collectAsyncRanges = (node: TNode, entryPath: string, ranges: [number, number][]): void => {
  if ('tagName' in node && node.tagName === 'script') {
    const src = node.attrs.find(({ name }) => name === 'src');
    const location = node.sourceCodeLocation?.attrs?.async;

    if (src?.value && location && getSrcPath(src.value) === entryPath) {
      ranges.push([location.startOffset, location.endOffset]);
    }
  }

  if ('childNodes' in node) {
    node.childNodes.forEach((child) => collectAsyncRanges(child, entryPath, ranges));
  }
};

/**
 * Remove async from the client entry script, so plugin preambles run before it.
 * The entry is found by the exact pathname of its src, as the HTML parser reads the document.
 */
const stripEntryAsync = (html: string, base: string | undefined, clientFile: string): string => {
  const entryPath = getSrcPath(path.posix.normalize(`${base ?? '/'}/${clientFile}`));
  const ranges: [number, number][] = [];

  collectAsyncRanges(parse(html, { sourceCodeLocationInfo: true }), entryPath, ranges);

  if (!ranges.length) {
    return html;
  }

  // Cut by position from the end, together with the whitespace before each attribute.
  const result = ranges
    .sort(([left], [right]) => right - left)
    .reduce((text, [start, end]) => text.slice(0, start).trimEnd() + text.slice(end), html);

  // The parser reports only the first of repeated attributes, so a repeated async needs a pass.
  return stripEntryAsync(result, base, clientFile);
};

export default stripEntryAsync;
