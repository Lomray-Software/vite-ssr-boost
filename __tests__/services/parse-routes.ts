// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { routeFixtures, writeFixture, writeRouteFixture } from '@__helpers__/project-fixture';
import ParseRoutes from '@services/parse-routes';
import ServerConfig from '@services/server-config';
import SsrManifest from '@services/ssr-manifest';

const directories: string[] = [];
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-boost-routes-test-'));
  directories.push(root);
  const config = ServerConfig.init({}, { root, clientFile: 'client.ts' });
  const parser = new ParseRoutes(config);
  return { root, parser, config };
};

afterEach(() => {
  directories.splice(0).forEach((root) => fs.rmSync(root, { force: true, recursive: true }));
  (SsrManifest as unknown as { instance: unknown }).instance = null;
});

describe('ordinary route declarations', () => {
  it.each(routeFixtures)('$name resolves the original module and route ID', (fixture) => {
    const { root, parser, config } = setup();
    writeRouteFixture(root, fixture);
    const tree = parser.parse();
    const manifest = SsrManifest.get(config) as unknown as {
      getRoutesTreeIds: (tree: ReturnType<ParseRoutes['parse']>) => Record<string, string>;
    };
    const result = manifest.getRoutesTreeIds(tree);
    const expectedId =
      {
        'explicit-id': 'about',
        'object-spread': 'about',
        'computed-keys': 'about',
        'skipped-position': '1-1',
        'imported-children': '0-0',
        'wrapped-arrays': '0-0',
      }[fixture.name] ?? '0';
    expect(result).toEqual({ [expectedId]: 'About' });
  });

  it.each([
    ['', ''],
    ['(', ')'],
    ['', ' satisfies import("react-router").RouteObject[]'],
    ['', ' as const'],
    ['((', ' as const) satisfies import("react-router").RouteObject[])!'],
  ])('unwraps array and children syntax %s ... %s', (prefix, suffix) => {
    const { root, parser } = setup();
    writeRouteFixture(root, {
      routes: `const routes = ${prefix}[{ children: ${prefix}[{ lazy: () => import('./About') }]${suffix} }]${suffix}; export default routes;`,
    });
    expect(parser.parse()[0].children[0].import).toBe(path.join(root, 'About'));
  });

  it('follows named re-exports, local aliases, spread override order, and JSX modules', () => {
    const { root, parser } = setup();
    writeRouteFixture(root, {
      routes: "export { routes as default } from './other';",
      files: {
        'other.tsx':
          "import Page from './Page'; const common = { id: 'first', lazy: () => import('./About') }; const routes = [{ ...common, id: 'second' }, { element: <Page /> }]; export { routes };",
        'Page.tsx': 'export default function Page() { return <p>Page</p>; }',
      },
    });
    expect(parser.parse()).toEqual([
      { index: 0, id: 'second', import: path.join(root, 'About'), children: [] },
      { index: 1, import: path.join(root, 'Page'), children: [] },
    ]);
  });

  it.each([
    ['export default makeRoutes();', 'routes array'],
    ['export default [{ ...makeShared() }];', 'object spread'],
    ['const key = "path"; export default [{ [key]: "/" }];', 'computed route key'],
    ['export default [{ lazy: () => import(moduleName) }];', 'dynamic lazy import'],
    ['export default [{ lazy: () => Promise.resolve({}) }];', 'lazy route result'],
    ['export default [{ lazy: { Component: () => import("./About") } }];', 'lazy route'],
    ['export default [{ children: makeChildren() }];', 'routes array'],
    ['export default [{ id: Math.random() }];', 'route id'],
    ['const shared = { ...shared }; export default [shared];', 'object spread'],
    ['const routes = [{ children: routes }]; export default routes;', 'routes array'],
    ['const routes = [...others]; export default routes;', 'route array spread'],
    ['export default [{ children: missing }];', 'unresolved binding missing'],
    ['const routes = other; const other = routes; export default routes;', 'circular binding'],
    ['export default {};', 'routes array'],
  ])('reports file, line and construct for %s', (routes, construct) => {
    const { root, parser } = setup();
    writeRouteFixture(root, { routes: `\n${routes}` });
    expect(() => parser.parse()).toThrow(
      new RegExp(`routes\\.ts:2:\\d+: Unsupported .*${construct}`),
    );
  });

  it('reports missing exports, imports and syntax without swallowing errors', () => {
    const { root, parser } = setup();
    writeRouteFixture(root, { routes: 'export const nothing = 1;' });
    expect(() => parser.parse()).toThrow(/routes.ts:1:1: Unsupported missing export "default"/);
    fs.rmSync(path.join(root, 'routes.ts'));
    expect(() => parser.parse()).toThrow(/client.ts:4:\d+: Unsupported missing import/);
    writeFixture(root, 'routes.ts', 'export default [');
    expect(() => parser.parse()).toThrow(/routes.ts: Unexpected token/);
  });

  it('does not mistake an unrelated local entryClient function for the library entry', () => {
    const { root, parser } = setup();
    writeFixture(root, 'client.ts', 'function entryClient() {} entryClient();');
    expect(() => parser.parse()).toThrow(/browser entry calls \(0\)/);
  });

  it('transforms computed lazy keys and async function/then imports once', () => {
    for (const lazy of [
      "() => import('./About')",
      "async function () { return await import('./About'); }",
      "() => import('./About').then(m => ({ Component: m.Component }))",
    ]) {
      const result = ParseRoutes.handleRoutes(`const routes = [{ ['lazy']: ${lazy} }];`, true);
      expect(result).toContain('pathId: "./About"');
      expect(result.match(/import n from/g)).toHaveLength(1);
      expect(result.match(/\bn\(/g)).toHaveLength(1);
    }
  });
});
