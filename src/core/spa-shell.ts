import type { IHtmlShell } from '@core/handler';
import createSpaHtml from '@core/spa-html';

/**
 * Cache generation for the current template, returning isolated mutable request shells.
 * Compare the source so development edits and request-specific getHtml values stay fresh.
 */
const createSpaShell = (): ((html: IHtmlShell) => IHtmlShell) => {
  let source: IHtmlShell | undefined;
  let shell: IHtmlShell;

  /**
   * Rebuild changed templates and isolate the shell returned to each request.
   */
  return (html) => {
    const { header, footer } = html;

    if (source?.header !== header || source?.footer !== footer) {
      source = { ...html };
      shell = { header: createSpaHtml(header), footer };
    }

    return { ...shell };
  };
};

export default createSpaShell;
