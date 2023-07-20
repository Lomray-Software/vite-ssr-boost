import { extname } from 'node:path';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import isRoutesFile from '@helpers/is-route-file';

export interface IPluginOptions {
  isSSR?: boolean;
}

/**
 * Add normalize wrapper to lazy imports for client build
 */
const normalizeRoutes = (code: string, isSSR: boolean): string =>
  `import n from '${PLUGIN_NAME}/helpers/import-route';${code}`.replace(
    /(lazy)(:\s*)(\(\)\s*=>\s*import\(([^)]+)\))/gs,
    isSSR ? 'lazy$2()=>n($3,$4)' : 'lazy$2()=>n($3)',
  );

/**
 * Add possibility to export route components like FCRoute or FCCRoute
 * Add route path for generating manifest
 * USAGE: { path: '/', lazy: () => import('./pages/home') }
 * @see FCRoute
 * @see FCCRoute
 * @see SsrManifest.getRoutesIds
 * @see importRoute
 * @constructor
 */
function ViteNormalizeRouterPlugin(options: IPluginOptions = {}): Plugin {
  const { isSSR = false } = options;

  return {
    name: `${PLUGIN_NAME}-normalize-route`,
    transform: (code, id) => {
      const extName = extname(id).split('?')[0]!;

      if (
        id.includes('node_modules') ||
        !['.js', '.ts', '.tsx'].includes(extName) ||
        !isRoutesFile(code)
      ) {
        return;
      }

      return {
        code: normalizeRoutes(code, isSSR),
        map: { mappings: '' },
      };
    },
  };
}

export default ViteNormalizeRouterPlugin;
