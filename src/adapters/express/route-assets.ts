import type { RouterState } from 'react-router';
import type { ViteDevServer } from 'vite';
import RouteAssets from '@services/route-assets';
import type ServerConfig from '@services/server-config';

/**
 * Own production manifest caches per managed server, including interactive restarts.
 */
const productionAssets = new WeakMap<ServerConfig, RouteAssets>();

/**
 * Keep source analysis and Vite graph access confined to development requests; in development
 * the assets come from the given Vite, by default the one the config holds.
 */
const getRouteAssets = async (
  config: ServerConfig,
  matches?: RouterState['matches'],
  isSpa = false,
  vite?: ViteDevServer,
): Promise<RouteAssets> => {
  if (!config.isProd) {
    const { default: SsrManifest } = await import('@services/ssr-manifest');
    const manifest = SsrManifest.get(config, {}, vite);

    await manifest.prepareDevAssets(matches, isSpa);

    return manifest;
  }

  let manifest = productionAssets.get(config);

  if (!manifest) {
    manifest = new RouteAssets(config.getParams().root, config.isModulePreload);
    productionAssets.set(config, manifest);
  }

  return manifest;
};

export default getRouteAssets;
