import path from 'node:path';

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const ATTRIBUTE = /(\s+)([^\s"'<>/=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

/**
 * Value of an HTML attribute with its quotes removed.
 */
const unquote = (value: string): string =>
  value.startsWith('"') || value.startsWith("'") ? value.slice(1, -1) : value;

/**
 * Pathname of a script src without query and fragment, with one leading slash.
 */
const getSrcPath = (src: string): string => `/${src.split(/[?#]/, 1)[0].replace(/^\/+/, '')}`;

/**
 * Remove async from the client entry script, so plugin preambles run before it.
 * The entry is found by the exact pathname of its src, wherever the attributes stand.
 */
const stripEntryAsync = (html: string, base: string | undefined, clientFile: string): string => {
  const entryPath = getSrcPath(path.posix.normalize(`${base ?? '/'}/${clientFile}`));

  return html.replace(SCRIPT_TAG, (tag) => {
    const attributes = [...tag.matchAll(ATTRIBUTE)];
    const src = attributes.find(([, , name, , value]) => name.toLowerCase() === 'src' && value);

    if (!src || getSrcPath(unquote(src[4])) !== entryPath) {
      return tag;
    }

    // Cut by position from the end, so text inside another attribute value is never touched.
    return attributes
      .filter(([, , name]) => name.toLowerCase() === 'async')
      .reverse()
      .reduce(
        (result, { 0: attribute, index }) =>
          result.slice(0, index) + result.slice(index + attribute.length),
        tag,
      );
  });
};

export default stripEntryAsync;
