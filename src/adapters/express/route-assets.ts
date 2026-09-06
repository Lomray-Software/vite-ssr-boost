import type { RouterState } from 'react-router';
import RouteAssets from '@services/route-assets';
import type ServerConfig from '@services/server-config';

/**
 * Own production manifest caches per managed server, including interactive restarts.
 */
const productionAssets = new WeakMap<ServerConfig, RouteAssets>();

/**
 * Keep source analysis and Vite graph access confined to development requests.
 */
const getRouteAssets = async (
  config: ServerConfig,
  matches?: RouterState['matches'],
  isSpa = false,
): Promise<RouteAssets> => {
  if (!config.isProd) {
    const { default: SsrManifest } = await import('@services/ssr-manifest');
    const manifest = SsrManifest.get(config);

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
