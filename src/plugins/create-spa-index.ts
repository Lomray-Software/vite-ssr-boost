import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import createSpaHtml from '@core/spa-html';
import { getCurrentEntrypointName } from '@plugins/handle-custom-entrypoint';

export interface IPluginOptions {
  filename?: string;
  rootId?: string;
}

const pluginName = `${PLUGIN_NAME}-create-spa-entrypoint`;

/**
 * Create additional entrypoint for SPA.
 * File: index-spa.html
 *
 * E.g. for service worker entrypoint
 * @constructor
 */
function ViteCreateSPAIndexPlugin(options: IPluginOptions = {}): Plugin {
  const { filename = 'index-spa.html', rootId = 'root' } = options;
  let spaHtml = '';

  return {
    name: pluginName,
    enforce: 'post',
    /**
     * Apply only on build but not for SSR
     */
    apply(_, { command, isSsrBuild }): boolean {
      return command === 'build' && !isSsrBuild && !getCurrentEntrypointName();
    },
    transformIndexHtml(html): string {
      spaHtml = createSpaHtml(html, rootId);

      return html;
    },
    generateBundle(): void {
      if (!spaHtml) {
        return;
      }

      this.emitFile({
        type: 'asset',
        fileName: filename,
        source: spaHtml,
      });
    },
  };
}

export default ViteCreateSPAIndexPlugin;
