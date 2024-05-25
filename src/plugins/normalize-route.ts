import { extname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';
import isRoutesFile from '@helpers/is-route-file';
import { writeMeta } from '@helpers/ssr-meta';

export interface IPluginOptions {
  isSSR?: boolean;
  isBuild?: boolean;
  routesPath?: string;
  isNodeParsing?: boolean;
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
    /(.*?(?:Component|element):[\s<]*(\w+)[^,}]*),*/gs,
    (fullMatch, before: string, routeName: string) => {
      const importPath = imports?.[routeName];

      if (!importPath) {
        return fullMatch;
      }

      return `${before},pathId: '${importPath}',`;
    },
  );
};

/**
 * Add normalize wrapper to lazy imports for client build
 */
const normalizeAsyncRoutes = (code: string, hasPathId: boolean): string => {
  const modifiedCode = code.replace(
    /(lazy)(:\s*)(\(\)\s*=>\s*import\(([^)]+)\))/gs,
    hasPathId ? 'lazy$2n($3,$4)' : 'lazy$2n($3)',
  );

  if (code !== modifiedCode) {
    return `import n from '${PLUGIN_NAME}/helpers/import-route';${modifiedCode}`;
  }

  return code;
};

/**
 * Add possibility to export route components like FCRoute or FCCRoute
 * Add route path for generating manifest
 * USAGE: { path: '/', lazy: () => import('./pages/home') }
 * @see FCRoute
 * @see FCCRoute
 * @see SsrManifest.getAsyncRoutesIds
 * @see importRoute
 * @constructor
 */
function ViteNormalizeRouterPlugin(options: IPluginOptions = {}): Plugin {
  const { routesPath, isNodeParsing = false, isSSR = false, isBuild = false } = options;
  const routeFiles = new Map<string, string>();
  const cfg = { root: '', buildDir: '' };

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

      routeFiles.set(id, '');

      return {
        // always add pathId to routes for development
        code: normalizeAsyncRoutes(
          normalizeSyncRoutes(code, isBuild),
          isSSR && (isNodeParsing || isBuild),
        ),
        map: { mappings: '' },
      };
    },
    ...(isNodeParsing
      ? {
          /**
           * Get build path
           */
          config(config, { isSsrBuild }): void {
            if (isSsrBuild) {
              return;
            }

            cfg.root = config.root!;
            cfg.buildDir = config.build!.outDir!;
          },
          /**
           * Get transformed route files
           */
          generateBundle(_, bundle) {
            for (const [fileName, chunk] of Object.entries(bundle)) {
              if (chunk.type === 'chunk') {
                Object.entries(chunk.modules).forEach(([modulePath]) => {
                  if (routeFiles.has(modulePath)) {
                    routeFiles.set(modulePath, fileName);
                  }
                });
              }
            }
          },
          /**
           * Save metadata on for client build
           * @see config hook
           */
          writeBundle(): void {
            if (!cfg.root) {
              return;
            }

            const [buildDir] = resolve(cfg.root, cfg.buildDir).split('/client');

            writeMeta(buildDir, { routeFiles: Object.fromEntries(routeFiles) });
          },
        }
      : {}),
  };
}

export default ViteNormalizeRouterPlugin;
