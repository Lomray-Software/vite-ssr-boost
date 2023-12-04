import { extname } from 'node:path';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import isRoutesFile from '@helpers/is-route-file';

export interface IPluginOptions {
  isSSR?: boolean;
  isBuild?: boolean;
  routesPath?: string;
}

/**
 * Add pathId to route (where pathId - import string)
 * NOTE: only for dev mode
 */
const normalizeSyncRoutes = (code: string, isBuild = false): string => {
  if (isBuild) {
    return code;
  }

  const imports: Record<string, string> = [
    ...code.matchAll(/import\s+(\w+)\sfrom\s+['"]([^'"]+)['"]/g),
  ].reduce(
    (res, [, key, value]) => ({
      [key]: value,
      ...res,
    }),
    {},
  );

  return code.replace(
    /(.*path:.*(?:Component|element):\s*(\w+)),*(.+)/s,
    (_, before, routeName: string, after: string) => {
      const importPath = imports?.[routeName];

      if (!importPath) {
        return before + after;
      }

      return `${before},\npathId: '${importPath}',${after}`;
    },
  );
};

/**
 * Add normalize wrapper to lazy imports for client build
 */
const normalizeAsyncRoutes = (code: string, isSSR: boolean): string =>
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
  const { isSSR = false, isBuild = false, routesPath } = options;

  return {
    name: `${PLUGIN_NAME}-normalize-route`,
    transform: (code, id) => {
      const extName = extname(id).split('?')[0]!;
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
        code: normalizeAsyncRoutes(normalizeSyncRoutes(code, isBuild), isSSR),
        map: { mappings: '' },
      };
    },
  };
}

export default ViteNormalizeRouterPlugin;
