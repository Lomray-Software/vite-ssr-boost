import type { IHtmlShell } from '@core/handler';
import createSpaHtml from '@core/spa-html';

/**
 * Cache generation for the current template, returning isolated mutable request shells.
 * Compare the source so development edits and request-specific getHtml values stay fresh.
 */
const createSpaShell = (): ((html: IHtmlShell) => IHtmlShell) => {
  let source: IHtmlShell | undefined;
  let shell: IHtmlShell;

  return (html) => {
    if (source?.header !== html.header || source?.footer !== html.footer) {
      source = { ...html };
      shell = { header: createSpaHtml(html.header), footer: html.footer };
    }

    return { ...shell };
  };
};

export default createSpaShell;
