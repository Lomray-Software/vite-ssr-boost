import path from 'node:path';
import type { Plugin } from 'vite';
import CliActions from '@constants/cli-actions';
import type { ICliContext } from '@constants/cli-context';
import PLUGIN_NAME from '@constants/plugin-name';
import ViteCreateSPAIndexPlugin from '@plugins/create-spa-index';
import type { IPluginOptions as ICreateSPAIndex } from '@plugins/create-spa-index';
import { ViteHandleCustomEntrypointPlugin } from '@plugins/handle-custom-entrypoint';
import type { IPluginOptions as IMakeAliasesPluginOptions } from '@plugins/make-aliases';
import ViteMakeAliasesPlugin from '@plugins/make-aliases';
import ViteNormalizeRouterPlugin from '@plugins/normalize-route';
import type { IBuildEndpoint } from '@services/build';

export interface IPluginOptions {
  // default: index.html
  indexFile?: string;
  // default: server.ts
  serverFile?: string;
  // default: client.ts
  clientFile?: string;
  // Path contains routes declaration files (need to detect route files). default: undefined, e.g.: /routes/
  routesPath?: string;
  // how parse routes
  // node - import routes file directly and walk through
  // babel - use babel travers to walk through and avoid import routes file
  // default: babel
  routesParsing?: 'node' | 'babel';
  // Create additional SPA entrypoint: index-spa.html
  // Can be used for service worker: createHandlerBoundToURL("index-spa.html")
  spaIndex?: boolean | ICreateSPAIndex;
  // Read aliases from tsconfig
  tsconfigAliases?: boolean | IMakeAliasesPluginOptions;
  customShortcuts?: {
    key: string;
    description: string;
    action: (cliContext: ICliContext) => Promise<void> | void;
    isOnlyDev?: boolean;
  }[];
  // Additional entry points for build
  entrypoint?: IBuildEndpoint[];
}

const defaultOptions: IPluginOptions = {
  indexFile: 'index.html',
  serverFile: 'server.ts',
  clientFile: 'client.ts',
  routesParsing: 'babel',
  tsconfigAliases: true,
  spaIndex: false,
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

      config(config, { isSsrBuild }) {
        config.define = {
          ...(config.define ?? {}),
          __IS_SSR__: isSSR,
        };

        config.build = {
          ...(config.build ?? {}),
        };

        if (!isSsrBuild) {
          if (isSSR && isBuild) {
            config.build.manifest = true;
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

  const { tsconfigAliases, routesPath, routesParsing, spaIndex, entrypoint } = mergedOptions;

  if (tsconfigAliases) {
    plugins.push(
      ViteMakeAliasesPlugin(typeof tsconfigAliases === 'boolean' ? undefined : tsconfigAliases),
    );
  }

  if (spaIndex) {
    plugins.push(ViteCreateSPAIndexPlugin(typeof spaIndex === 'boolean' ? undefined : spaIndex));
  }

  if (entrypoint?.length) {
    plugins.push(ViteHandleCustomEntrypointPlugin({ entrypoint }));
  }

  plugins.push(
    ViteNormalizeRouterPlugin({
      isSSR,
      isBuild,
      routesPath,
      isNodeParsing: routesParsing === 'node',
    }),
  );

  return plugins;
}

export default ViteSsrBoostPlugin;
