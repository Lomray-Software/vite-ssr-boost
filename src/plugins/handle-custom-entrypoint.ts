import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IBuildEntrypoint } from '@services/build';

export interface IPluginOptions {
  entrypoint: IBuildEntrypoint;
}

const pluginName = `${PLUGIN_NAME}-handle-custom-entrypoint`;

/**
 * Get current entrypoint name
 */
const getCurrentEntrypointName = (): string | undefined =>
  process.env.SSR_BOOST_CUSTOM_ENTRYPOINT_BUILD_NAME;

/**
 * Set current entrypoint name
 */
const setCurrentEntrypointName = (name: string): void => {
  process.env.SSR_BOOST_CUSTOM_ENTRYPOINT_BUILD_NAME = name;
};

/**
 * Find current entrypoint by env
 */
const getCurrentEntrypoint = (
  entrypoint: IBuildEntrypoint[],
  currentEntrypointName = getCurrentEntrypointName(),
): IBuildEntrypoint | null => {
  if (!entrypoint.length || !currentEntrypointName) {
    return null;
  }

  for (const entry of entrypoint) {
    if (entry.name === currentEntrypointName && !entry.serverFile) {
      return entry;
    }
  }

  return null;
};

/**
 * Return custom entrypoint instead default (index.html).
 *
 * E.g. for build multiple entrypoint
 * @constructor
 */
function ViteHandleCustomEntrypointPlugin(options: IPluginOptions): Plugin {
  const { entrypoint } = options;
  let outPath = '';
  let origClientFile = '';

  return {
    name: pluginName,
    enforce: 'pre',
    /**
     * Apply only on build but not for SSR and only for custom entrypoint
     */
    apply(_, { isSsrBuild }): boolean {
      return !isSsrBuild && Boolean(entrypoint);
    },
    config(config) {
      const { indexFile } = entrypoint;
      const buildConfig = config.build ?? {};
      const indexFilePath = indexFile ? path.resolve(config.root ?? '', indexFile) : undefined;

      return {
        ...config,
        build: {
          ...buildConfig,
          rollupOptions: {
            ...(buildConfig.rollupOptions ?? {}),
            input: indexFilePath,
          },
        },
      };
    },
    configResolved(config) {
      const pluginConfig = config.plugins.find((plugin) => plugin.name === PLUGIN_NAME);

      outPath = path.resolve(config.root, config.build.outDir);
      // @ts-expect-error pluginOptions is custom param
      origClientFile = (pluginConfig.pluginOptions as Record<string, any>).clientFile as string;
    },
    transform(code, id) {
      if (id.endsWith('.html')) {
        const { clientFile } = entrypoint;

        if (clientFile) {
          return {
            code: code.replace(origClientFile, clientFile),
            map: this.getCombinedSourcemap(),
          };
        }
      }

      return {
        code,
        map: this.getCombinedSourcemap(),
      };
    },
    /**
     * Development mode
     */
    transformIndexHtml(html, { originalUrl, server }): string {
      const { clientFile } = entrypoint;

      if (clientFile && server?.config.command === 'serve' && originalUrl?.endsWith('.html')) {
        return html.replace(origClientFile, clientFile);
      }

      return html;
    },
    closeBundle() {
      const { indexFile } = entrypoint;

      if (!indexFile) {
        return;
      }

      const indexFilePath = path.resolve(outPath, path.basename(indexFile));

      if (fs.existsSync(indexFilePath)) {
        fs.renameSync(indexFilePath, path.resolve(outPath, 'index.html'));
      }
    },
  };
}

export {
  ViteHandleCustomEntrypointPlugin,
  getCurrentEntrypoint,
  getCurrentEntrypointName,
  setCurrentEntrypointName,
};
