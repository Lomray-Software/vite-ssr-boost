import path from 'node:path';
import type { Plugin } from 'vite';
import CliActions from '@constants/cli-actions';
import type { ICliContext } from '@constants/cli-context';
import PLUGIN_NAME from '@constants/plugin-name';
import type { IPluginOptions as IMakeAliasesPluginOptions } from '@plugins/make-aliases';
import ViteMakeAliasesPlugin from '@plugins/make-aliases';
import ViteNormalizeRouterPlugin from '@plugins/normalize-route';

export interface IPluginOptions {
  indexFile?: string; // default: index.html
  serverFile?: string; // default: server.ts
  clientFile?: string; // default: client.ts
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
  clientFile: 'client.ts',
  tsconfigAliases: true,
};

/**
 * Init plugin
 * @constructor
 */
function ViteSsrBoostPlugin(options: IPluginOptions = {}): Plugin[] {
  const dirInfo = new URL(import.meta.url);
  const action = (global.viteBoostAction || process.env.SSR_BOOST_ACTION) as CliActions;
  const mergedOptions: IPluginOptions = { ...defaultOptions, ...options };
  const isSSR = process.env.SSR_BOOST_IS_SSR === '1' || action === CliActions.dev;
  const isBuild = action === CliActions.build;

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
          __IS_SSR__: isSSR,
        };

        config.build = {
          ...(config.build ?? {}),
          // modulePreload: config.build?.modulePreload ?? false,
        };

        if (!ssrBuild) {
          if (isSSR && isBuild) {
            config.build!.manifest = true;
          }

          return config;
        }

        return {
          ...config,
          ...(isBuild ? { appType: 'custom' } : {}),
          publicDir: false,
        };
      },
    },
  ];

  const { tsconfigAliases } = mergedOptions;

  if (tsconfigAliases) {
    plugins.push(
      ViteMakeAliasesPlugin(typeof tsconfigAliases === 'boolean' ? undefined : tsconfigAliases),
    );
  }

  plugins.push(ViteNormalizeRouterPlugin({ isSSR }));

  return plugins;
}

export default ViteSsrBoostPlugin;
