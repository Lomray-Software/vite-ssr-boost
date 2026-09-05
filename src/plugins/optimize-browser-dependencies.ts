import type { DepOptimizationOptions } from 'vite';
import PLUGIN_NAME from '@constants/plugin-name';

// Enumerate deep imports so individual exclusions work without expanding a glob.
// Both public spellings are exported by the package.
const browserImports = [
  'browser/entry',
  'components/navigate',
  'components/only-client',
  'components/render-client',
  'components/response-status',
  'components/scroll-to-top',
  'components/with-suspense',
  'constants/common',
  'context/server',
  'helpers/get-server-state',
  'helpers/import-route',
  'interfaces/fc-route',
].flatMap((id) => [`${PLUGIN_NAME}/${id}`, `${PLUGIN_NAME}/${id}.js`]);

const browserDependencies = [
  'react',
  'react-dom',
  'react-dom/client',
  'react-router',
  'hoist-non-react-statics',
  ...browserImports,
];

const normalizeImport = (id: string): string =>
  id.startsWith(`${PLUGIN_NAME}/`) ? id.replace(/\.js$/, '') : id;

/**
 * Include imports injected by route normalization before the first browser request.
 */
const optimizeBrowserDependencies = (
  options: DepOptimizationOptions = {},
): DepOptimizationOptions => ({
  ...options,
  include: [...new Set([...(options.include ?? []), ...browserDependencies])].filter(
    (id) =>
      !(options.exclude ?? []).some((excluded) => {
        const dependency = normalizeImport(id);
        const exclusion = normalizeImport(excluded).replace(/\/$/, '');

        // Match Vite's package/subpath exclusions, including our .js aliases.
        return dependency === exclusion || dependency.startsWith(`${exclusion}/`);
      }),
  ),
});

export default optimizeBrowserDependencies;
