import path from 'node:path';
import type { Plugin } from 'vite';
import CliActions from '@constants/cli-actions';
import type { ICliContext } from '@constants/cli-context';
import PLUGIN_NAME from '@constants/plugin-name';
import ViteMakeAliasesPlugin from '@plugins/make-aliases';
import type { IPluginOptions as IMakeAliasesPluginOptions } from '@plugins/make-aliases';
import ViteNormalizeRouterPlugin from '@plugins/normalize-route';

export interface IPluginOptions {
  indexFile?: string; // default: index.html
  serverFile?: string; // default: server.ts
  abortDelay?: number; // How long the server waits for data before giving up. default: 10000 (10 sec)
  hasLazyRoutePlugin?: boolean; // Possibility to use custom export route component @see FCRoute interface
  tsconfigAliases?: boolean | IMakeAliasesPluginOptions; // Read aliases from tsconfig
  customShortcuts?: {
    key: string;
    description: string;
    action: (cliContext: ICliContext) => Promise<void> | void;
    isOnlyDev?: boolean;
  }[];
}

const defaultOptions: IPluginOptions = {
  indexFile: 'index.html',
  serverFile: 'server.ts',
  abortDelay: 10000,
  hasLazyRoutePlugin: true,
  tsconfigAliases: true,
};

/**
 * Init insane vite ssr plugin
 * @constructor
 */
function ViteSsrInsanePlugin(options: IPluginOptions = {}): Plugin[] {
  const dirInfo = new URL(import.meta.url);
  const action = global.viteBoostAction as CliActions;
  const mergedOptions: IPluginOptions = { ...defaultOptions, ...options };

  const plugins: Plugin[] = [
    {
      name: PLUGIN_NAME,
      enforce: 'pre',
      // @ts-ignore save custom options
      pluginOptions: {
        ...mergedOptions,
        pluginPath: path.dirname(dirInfo.pathname),
        action,
        isDev: action === CliActions.dev,
      },
      config(config, { ssrBuild }) {
        config.define = {
          ...(config.define ?? {}),
          __IS_SSR__: process.env.SSR_BOOST_IS_SSR === '1' || action === 'dev',
        };

        if (!ssrBuild) {
          return config;
        }

        return {
          ...config,
          publicDir: false,
        };
      },
    },
  ];

  const { hasLazyRoutePlugin, tsconfigAliases } = mergedOptions;

  if (hasLazyRoutePlugin) {
    plugins.push(ViteNormalizeRouterPlugin());
  }

  if (tsconfigAliases) {
    plugins.push(
      ViteMakeAliasesPlugin(typeof tsconfigAliases === 'boolean' ? undefined : tsconfigAliases),
    );
  }

  return plugins;
}

export default ViteSsrInsanePlugin;
