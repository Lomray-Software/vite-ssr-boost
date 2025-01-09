import { extname } from 'node:path';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import isRoutesFile from '@helpers/is-route-file';
import ParseRoutes from '@services/parse-routes';

export interface IPluginOptions {
  isSSR?: boolean;
  isBuild?: boolean;
  routesPath?: string;
}

/**
 * Add possibility to export route components like FCRoute or FCCRoute
 * USAGE: { path: '/', lazy: () => import('./pages/home') }
 * @see FCRoute
 * @see FCCRoute
 * @see importRoute
 * @constructor
 */
function ViteNormalizeRouterPlugin(options: IPluginOptions = {}): Plugin {
  const { routesPath, isSSR = false, isBuild = false } = options;

  return {
    name: `${PLUGIN_NAME}-normalize-route`,
    enforce: 'pre',
    transform(code, id) {
      const [extName] = extname(id).split('?');
      const isRoutesPath = !routesPath || id.includes(routesPath);

      if (
        id.includes('node_modules') ||
        !['.js', '.mjs', '.ts', '.tsx'].includes(extName) ||
        !isRoutesPath ||
        !isRoutesFile(code)
      ) {
        return;
      }

      return {
        code: ParseRoutes.handleRoutes(
          code,
          // always add pathId to routes for development
          isSSR && !isBuild,
        ),
        map: { mappings: '' },
      };
    },
  };
}

export default ViteNormalizeRouterPlugin;
