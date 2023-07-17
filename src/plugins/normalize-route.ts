import { extname } from 'node:path';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import isRoutesFile from '@helpers/is-route-file';

export interface IPluginOptions {
  isSSR?: boolean;
}

/**
 * Add normalize wrapper to lazy imports for server build
 */
const normalizeRoutesSSR = (code: string): string =>
  `import n from '${PLUGIN_NAME}/helpers/import-route';${code}`.replace(
    /(lazyNR|lazy)(:\s*)(\(\)\s*=>\s*import\(([^)]+)\))/gs,
    'lazy$2()=>n($3,$4)',
  );

/**
 * Add normalize wrapper to lazy imports for client build
 */
const normalizeRoutes = (code: string): string =>
  `import n from '${PLUGIN_NAME}/helpers/import-route';${code}`.replace(
    /(lazyNR)(:\s*)(\(\)\s*=>\s*import\(([^)]+)\))/gs,
    'lazy$2()=>n($3)',
  );

/**
 * Add possibility to export route components like FCRoute or FCCRoute
 * USAGE: { path: '/', lazyNR: () => import('./pages/home') }
 * @see FCRoute
 * @see FCCRoute
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
        code: isSSR ? normalizeRoutesSSR(code) : normalizeRoutes(code),
        map: { mappings: '' },
      };
    },
  };
}

export default ViteNormalizeRouterPlugin;
