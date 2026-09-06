// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFixture, writeFixture } from '@__helpers__/project-fixture';
import runInit, { planInit } from '@cli/init';
import { MANUAL_GUIDE } from '@cli/project';

const directories: string[] = [];
const fixture = (layout = 'root-inline') => {
  const root = copyFixture(layout);
  directories.push(root);
  return root;
};
const contents = (root: string) =>
  Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => fs.statSync(path.join(root, file)).isFile())
      .sort()
      .map((file) => [file, fs.readFileSync(path.join(root, file), 'utf8')]),
  );

afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  process.exitCode = 0;
  vi.restoreAllMocks();
});

describe('init', () => {
  it.each(['root-inline', 'src-export', 'javascript', 'alias-wrapper'])(
    '%s has a complete dry-run diff and applies idempotently',
    (layout) => {
      const root = fixture(layout);
      const before = contents(root);
      const info = vi.spyOn(console, 'info');
      runInit({ root });
      expect(process.exitCode).not.toBe(1);
      expect(info.mock.calls.map(([line]) => line).join('\n')).toMatchSnapshot();
      expect(contents(root)).toEqual(before);
      const plan = planInit({ root });
      runInit({ root, apply: true });
      for (const change of plan)
        expect(fs.readFileSync(path.join(root, change.file), 'utf8')).toBe(change.after);
      const applied = contents(root);
      expect(planInit({ root })).toEqual([]);
      runInit({ root, apply: true });
      expect(contents(root)).toEqual(applied);
    },
  );

  it.each([
    ['named', '{ routes }', 'routes', './routes', 'export const routes'],
    [
      'named alias',
      '{ appRoutes as pageRoutes }',
      'pageRoutes',
      './routes',
      'export const appRoutes',
    ],
    ['default', 'routes', 'routes', './routes', 'const routes'],
    ['default alias with extension', 'pageRoutes', 'pageRoutes', './routes.ts', 'const routes'],
  ])(
    'preserves the %s route binding and original module specifier',
    (_label, binding, local, specifier, declaration) => {
      const root = fixture('src-export');
      const file = path.join(root, 'src/routes.ts');
      let routes = fs.readFileSync(file, 'utf8').replace('export const appRoutes', declaration);
      if (declaration === 'const routes') routes += '\nexport default routes\n';
      fs.writeFileSync(file, routes);
      const main = path.join(root, 'src/main.tsx');
      const original = `import ${binding} from '${specifier}'`;
      fs.writeFileSync(
        main,
        fs
          .readFileSync(main, 'utf8')
          .replace("import { appRoutes as routes } from './routes'", original)
          .replace('createBrowserRouter(routes)', `createBrowserRouter(${local})`),
      );
      const plan = planInit({ root });
      for (const name of ['src/main.tsx', 'src/server.ts']) {
        const output = plan.find((change) => change.file === name)!.after;
        expect(output).toContain(original);
        expect(output).not.toContain('routes as routes');
        expect(output).toContain(`(App, ${local})`);
      }
    },
  );

  it.each(['strict', 'fragment', 'shorthand', 'none', 'namespace', 'react-default'])(
    'generates a shared explicit App for a %s wrapper in TS and JS',
    (wrapper) => {
      for (const layout of ['root-inline', 'javascript']) {
        const root = fixture(layout);
        const isTS = layout === 'root-inline';
        const main = path.join(root, `src/main.${isTS ? 'tsx' : 'jsx'}`);
        let code = fs.readFileSync(main, 'utf8');
        if (wrapper === 'namespace' || wrapper === 'react-default')
          code = code
            .replace(
              "import { StrictMode } from 'react'",
              `import ${wrapper === 'namespace' ? '* as React' : 'React'} from 'react'`,
            )
            .replaceAll('StrictMode', 'React.Fragment');
        if (wrapper === 'fragment') code = code.replaceAll('StrictMode', 'Fragment');
        if (wrapper === 'shorthand')
          code = code.replace('<StrictMode>', '<>').replace('</StrictMode>', '</>');
        if (wrapper === 'none')
          code = code.replace('<StrictMode>', '').replace('</StrictMode>', '');
        fs.writeFileSync(main, code);
        const plan = planInit({ root });
        const browser = plan.find((change) =>
          change.file.endsWith(isTS ? 'main.tsx' : 'main.jsx'),
        )!.after;
        const server = plan.find((change) =>
          change.file.endsWith(isTS ? 'server.ts' : 'server.js'),
        )!.after;
        const tag =
          wrapper === 'strict'
            ? 'StrictMode'
            : wrapper === 'fragment'
              ? 'Fragment'
              : ['namespace', 'react-default'].includes(wrapper)
                ? 'React.Fragment'
                : '';
        expect(browser).toContain(
          `const App${isTS ? ': FC<PropsWithChildren>' : ''} = ({ children }) => <${tag}>{children}</${tag}>`,
        );
        expect(server).toContain(
          `const App${isTS ? ': FC<PropsWithChildren>' : ''} = ({ children }) => ssrCreateElement(${tag || 'ssrFragment'}, null, children)`,
        );
        expect(browser).toContain('entryClient(App, routes)');
        expect(server).toContain('entryServer(App, routes)');
        if (!isTS) {
          expect(browser + server).not.toMatch(/import type|PropsWithChildren|\bFC\b/);
        }
      }
    },
  );

  it.each([
    [{ dev: 'vite --host' }, { dev: 'ssr-boost dev' }],
    [{ develop: 'vite --host' }, { develop: 'ssr-boost dev' }],
    [{}, { develop: 'ssr-boost dev' }],
    [
      { dev: 'vite', develop: 'custom-command' },
      { dev: 'ssr-boost dev', develop: 'custom-command' },
    ],
  ])('selects the existing development script: %j', (before, after) => {
    const root = fixture();
    const file = path.join(root, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...pkg, scripts: { ...before, lint: 'eslint .' } }));
    const change = planInit({ root }).find((item) => item.file === 'package.json')!;
    expect(JSON.parse(change.after).scripts).toEqual({
      ...after,
      lint: 'eslint .',
      build: 'ssr-boost build',
      'start:ssr': 'ssr-boost start',
    });
  });

  it('supports explicit entry and exported routes overrides', () => {
    const root = fixture('src-export');
    expect(planInit({ root, entry: 'src/main.tsx', routes: 'src/routes.ts' })).toEqual(
      planInit({ root }),
    );
  });

  it.each([
    [
      'no router',
      'src/main.tsx',
      "import App from './App'; export default App;",
      /createBrowserRouter calls \(0\)/,
    ],
    [
      'JSX BrowserRouter',
      'src/main.tsx',
      "import { BrowserRouter } from 'react-router'; const app = <BrowserRouter />;",
      /JSX BrowserRouter/,
    ],
    [
      'multiple entries',
      'index.html',
      '<div id="root"></div><script type="module" src="/a.ts"></script><script type="module" src="/b.ts"></script>',
      /module entries \(2\)/,
    ],
    ['base', 'vite.config.ts', "export default { base: '/app/', plugins: [] };", /Vite base/],
    ['existing server', 'src/server.ts', 'export default "mine";', /existing server entry/],
    [
      'missing root',
      'index.html',
      '<div id="app"></div><script type="module" src="/src/main.tsx"></script>',
      /root element/,
    ],
    ['runtime config', 'vite.config.ts', 'export default getConfig();', /Vite configuration/],
  ])('stops without writes for %s', (_name, file, text, error) => {
    const root = fixture();
    writeFixture(root, file, text);
    const before = contents(root);
    const stderr = vi.spyOn(console, 'error');
    runInit({ root, apply: true });
    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.flat().join('\n')).toMatch(error);
    expect(stderr.mock.calls.flat().join('\n')).toContain(MANUAL_GUIDE);
    expect(contents(root)).toEqual(before);
  });

  it.each([
    [
      'createBrowserRouter(routes)',
      "createBrowserRouter(routes, { basename: '/app' })",
      /router options/,
    ],
    ["document.getElementById('root')!", "document.getElementById('root')!, {}", /React mount/],
    ['router={router}', 'router={router} fallbackElement={<p>Loading</p>}', /RouterProvider props/],
    ['const router =', 'const unrelated = 1; const router =', /additional browser startup/],
  ])('rejects bootstrap settings it cannot preserve: %s', (before, after, expected) => {
    const root = fixture();
    const file = path.join(root, 'src/main.tsx');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(before, after));
    expect(() => planInit({ root })).toThrow(expected);
  });

  it.each([
    'https://example.com/main.tsx',
    '//example.com/main.tsx',
    '/src/main.tsx?import',
    '/src/main.tsx#app',
  ])(
    'rejects non-local entry URLs, including query/fragment characters after the path: %s',
    (src) => {
      const root = fixture();
      const file = path.join(root, 'index.html');
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('/src/main.tsx', src));
      expect(() => planInit({ root })).toThrow('non-local browser entry URL');
    },
  );

  it('anchors the protocol-relative URL alternative to the start of the entry', () => {
    const root = fixture();
    const file = path.join(root, 'index.html');
    fs.writeFileSync(
      file,
      fs.readFileSync(file, 'utf8').replace('/src/main.tsx', '/src//main.tsx'),
    );
    expect(planInit({ root }).some((change) => change.file === 'src/main.tsx')).toBe(true);
  });

  it('keeps CRLF, quotes, comments and plugins in untouched code', () => {
    const root = fixture();
    const file = path.join(root, 'vite.config.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/'/g, '"').replace(/\n/g, '\r\n'));
    const diff = planInit({ root }).find((change) => change.file === 'vite.config.ts')!;
    expect(diff.after).toContain('import SsrBoost from "@lomray/vite-ssr-boost/plugin"\r\n');
    expect(diff.after).toContain('// Keep the React plugin and this comment.\r\n');
    expect(diff.after).toContain('react()]');
  });
});
