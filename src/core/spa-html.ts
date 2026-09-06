/**
 * Generate the SPA mount marker for built indexes and server response shells.
 * The document marker also supports applications using a custom browser root id.
 */
const createSpaHtml = (html: string, rootId = 'root'): string => {
  let isMarked = false;
  const result = html.replace(/<[^!/>][^>]*>/g, (tag) => {
    const id = /\sid\s*=\s*(["'])(.*?)\1/.exec(tag)?.[2];

    if (id !== rootId) {
      return tag;
    }

    isMarked = true;

    return /\bdata-force-spa\s*=/.test(tag)
      ? tag.replace(/\bdata-force-spa\s*=\s*(["']).*?\1/, 'data-force-spa="1"')
      : tag.replace(/(\sid\s*=\s*(["']).*?\2)/, '$1 data-force-spa="1"');
  });

  return isMarked
    ? result
    : result.replace(/<html\b[^>]*>/i, (tag) =>
        /\bdata-force-spa\s*=/.test(tag)
          ? tag.replace(/\bdata-force-spa\s*=\s*(["']).*?\1/, 'data-force-spa="1"')
          : tag.replace(/<html\b/i, '<html data-force-spa="1"'),
      );
};

export default createSpaHtml;
