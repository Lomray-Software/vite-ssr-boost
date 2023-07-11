import { extname } from 'node:path';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';

/**
 * Detect route file
 */
const isRoutesFile = (code: string): boolean => /\[.*{.*path:.*lazyNR:.+import/s.test(code);

/**
 * Add normalize wrapper to lazy imports
 */
const normalizeRoutes = (code: string): string =>
  `import n from '${PLUGIN_NAME}/helpers/import-route';${code}`.replace(
    /(lazyNR)(:\s*)(\(\)\s*=>\s*import\([^)]+\))/gs,
    'lazy$2()=>n($3)',
  );

/**
 * Add possibility to export route components like FCRoute or FCCRoute
 * USAGE: { path: '/', lazyNR: () => import('./pages/home') }
 * @see FCRoute
 * @see FCCRoute
 * @constructor
 */
function ViteNormalizeRouterPlugin(): Plugin {
  return {
    name: `${PLUGIN_NAME}-normalize-route`,
    transform: (code, id) => {
      const extName = extname(id);

      if (
        id.includes('node_modules') ||
        !['.js', '.ts', '.tsx'].includes(extName) ||
        !isRoutesFile(code)
      ) {
        return;
      }

      return {
        code: normalizeRoutes(code),
        map: { mappings: '' },
      };
    },
  };
}

export default ViteNormalizeRouterPlugin;
