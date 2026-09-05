import { appendFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

// KB means 1024 bytes throughout. Recalibrate only for an intentional size change:
// per entry = ceil(measured KB * 1.25 * 4) / 4; combined = measured KB + 1.
const BROWSER_GZIP_BUDGETS_KB = {
  'browser/entry': 1,
  'components/navigate': 0.5,
  'components/only-client': 0.5,
  'components/render-client': 2.25,
  'components/response-status': 0.25,
  'components/scroll-to-top': 0.5,
  'components/with-suspense': 2.25,
  'constants/common': 0.25,
  'context/server': 0.25,
  'helpers/get-server-state': 0.25,
  'helpers/import-route': 2.5,
  'interfaces/fc-route': 0.25,
};
const COMBINED_GZIP_BUDGET_KB = 4410 / 1024; // 3386 measured bytes + 1024 bytes.

const projectRoot = process.cwd();
const lib = resolve(projectRoot, 'lib');
const { exports: publicExports } = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));

// Expand JavaScript runtime targets in the exports map against lib, deduplicating
// extensionless/.js aliases. Exclude server runtimes (server, core, edge, node,
// adapters), CLI/plugin/build services and their helper/constant paths. Shared
// context/server and helpers/get-server-state ARE browser entries despite their names.
// Everything else is covered automatically; a new entry needs an explicit budget.
const excludedPaths = [
  /^(?:server|core|edge|node|adapters?|cli|plugins?|services|workflow)(?:\/|\.js$)/,
  /^constants\/(?:cli-|plugin-|stream-error\.js$)/,
  /^helpers\/(?:build-(?:custom|router)-state|create-focus-only|dev-marker|html-escape|is-route-file|obtain-stream-error|plugin-config|print-server-(?:info|urls)|process-stop|resolve-server-urls|serialize-errors|vite-aliases)\.js$/,
  // These exports have declarations but no browser runtime.
  /^interfaces\/(?:fc|route-object)\.js$/,
];

const runtimeTarget = (target) => {
  if (typeof target === 'string' || target === null) return target;
  for (const [condition, value] of Object.entries(target)) {
    if (['browser', 'import', 'default'].includes(condition)) {
      const selected = runtimeTarget(value);
      if (selected !== undefined) return selected;
    }
  }
};

const files = (await readdir(lib, { recursive: true })).filter((file) => file.endsWith('.js'));
const entries = new Set();

for (const target of Object.values(publicExports).map(runtimeTarget)) {
  if (!target?.endsWith('.js')) continue;
  const [prefix, suffix] = target.slice(2).split('*');
  const matches = suffix === undefined
    ? [prefix]
    : files.filter((file) => file.startsWith(prefix) && file.endsWith(suffix));
  for (const file of matches) {
    if (!excludedPaths.some((pattern) => pattern.test(file))) entries.add(file.slice(0, -3));
  }
}

if (!entries.size) throw new Error('No browser exports found. Run npm run build first.');

const options = {
  absWorkingDir: projectRoot,
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react-router'],
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'reject-server-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^(?:node:|(?:express|chalk|commander|json5)(?:\/|$))/ }, ({ path, importer }) => ({
        errors: [{ text: `Forbidden browser dependency ${path} imported by ${importer}` }],
      }));
    },
  }],
};

const rows = [];
let failed = false;
const measure = async (name, input, budget) => {
  const budgetLabel = budget?.toFixed(3) ?? 'missing';
  try {
    const { outputFiles } = await build({ ...options, ...input });
    const bytes = gzipSync(outputFiles[0].contents, { level: 9 }).length;
    const passed = Number.isFinite(budget) && budget > 0 && bytes <= budget * 1024;
    rows.push(`| ${name} | ${bytes} | ${(bytes / 1024).toFixed(3)} | ${budgetLabel} | ${passed ? 'PASS' : 'FAIL'} |`);
    if (!passed) failed = true;
  } catch (error) {
    failed = true;
    rows.push(`| ${name} | — | — | ${budgetLabel} | FAIL (bundle) |`);
    console.error(`${name}: ${error.message}`);
  }
};

const sortedEntries = [...entries].sort();
for (const entry of sortedEntries) {
  await measure(entry, { entryPoints: [resolve(lib, `${entry}.js`)] }, BROWSER_GZIP_BUDGETS_KB[entry]);
}

await measure('Combined', {
  stdin: {
    // Re-export each imported namespace so tree shaking cannot erase unused APIs.
    contents: sortedEntries.map((entry, index) =>
      `import * as entry${index} from './${entry}.js'; export { entry${index} };`).join('\n'),
    resolveDir: lib,
    sourcefile: 'browser-size-combined.js',
    loader: 'js',
  },
}, COMBINED_GZIP_BUDGET_KB);

for (const entry of Object.keys(BROWSER_GZIP_BUDGETS_KB)) {
  if (!entries.has(entry)) {
    failed = true;
    console.error(`Stale browser size budget: ${entry}`);
  }
}

const markdown = [
  '## Browser size budgets',
  '',
  'Minified ESM; gzip level 9; KB = 1024 bytes. React, React DOM and React Router are external.',
  '',
  '| Entry | Gzip bytes | Gzip KB | Budget KB | Result |',
  '| --- | ---: | ---: | ---: | --- |',
  ...rows,
  '',
].join('\n');

console.info(markdown);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
if (failed) process.exitCode = 1;
