import fs from 'fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import {
  routesCode1Before,
  routesCode2Before,
  routesCode4Before,
  routesDetailsCode,
} from '@__mocks__/route-file';
import { viteAliases } from '@__mocks__/vite-aliases';
import ParseRoutes from '@services/parse-routes';
import ServerConfig from '@services/server-config';

const clientEntrypoint = (hasAlias = false, isNamedImport = false) => `
import entryClient from '@lomray/vite-ssr-boost/browser/entry';
import ${isNamedImport ? '{ routes }' : 'routes'} from '${hasAlias ? '@' : './'}routes/index';

void entryClient(App, routes, {});
`;
const notLazyImport = '@pages/not-lazy';
const rootDir = '/src';
const clientFile = 'client.tsx';
const arrayWrappers = [
  ['plain array', '', ''],
  ['satisfies', '', ' satisfies TRouteObject[]'],
  ['as', '', ' as TRouteObject[]'],
  ['as const', '', ' as const'],
  ['parentheses', '(', ')'],
  ['non-null assertion', '(', ')!'],
  ['combined wrappers', '((', ' as const) satisfies TRouteObject[])!'],
];
const routeImports = `
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
import NotLazyPage from '@pages/not-lazy';
`;
const childRoutes = `[
  { Component: NotLazyPage },
  { lazy: () => import('@pages/home') },
]`;

describe('parse-routes', () => {
  const sandbox = sinon.createSandbox();
  const serverConfig = ServerConfig.init(
    { isProd: true, mode: 'production' },
    { root: rootDir, clientFile },
  );
  const routesService = new ParseRoutes(serverConfig, viteAliases);

  /**
   * Helper to stub exist route file
   */
  const stubExistFiles = (): void => {
    sandbox.stub(fs, 'existsSync').returns(true);
    // @ts-expect-error no need implement all methods
    sandbox.stub(fs, 'statSync').callsFake((filename) => {
      // noinspection JSUnusedGlobalSymbols
      return { isFile: () => Boolean(path.extname(filename as string)) };
    });
  };

  afterEach(() => {
    sandbox.restore();
  });

  it('should not find client entrypoint and throw error', () => {
    expect(() => routesService.parse()).toThrow('Unable to find routes file');
  });

  it('should not find routes import in client entrypoint and throw error', () => {
    sandbox.stub(fs, 'readFileSync').returns(`
    import entryClient from '@lomray/vite-ssr-boost/browser/entry';

    void entryClient(App, routes, {});
    `);

    expect(() => routesService.parse()).toThrow('Unable to find routes file');
  });

  it('should parse ssr boost client entrypoint and find routes import', () => {
    stubExistFiles();

    const readFileSyncStub = sandbox.stub(fs, 'readFileSync').returns(clientEntrypoint(true));

    const tree = routesService.parse();
    const entrypointFile = readFileSyncStub.firstCall.firstArg as string;
    const routeFile = readFileSyncStub.secondCall.firstArg as string;

    expect(tree).to.deep.equal([]);
    expect(entrypointFile).to.deep.equal(`${rootDir}/${clientFile}`);
    expect(routeFile).to.deep.equal(`${rootDir}/routes/index.js`);
  });

  it('should parse route file', () => {
    stubExistFiles();

    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint())
      .onSecondCall()
      .returns(routesCode4Before);

    const tree = routesService.parse();

    expect(tree).to.deep.equal([
      {
        index: 0,
        import: '@components/layouts/app',
        children: [
          {
            index: 0,
            import: '',
            children: [{ index: 0, import: '@pages/sign-in', children: [] }],
          },
        ],
      },
    ]);
  });

  it('should parse multiple route files with async and static imports', () => {
    stubExistFiles();

    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint())
      .onSecondCall()
      .returns(routesCode1Before)
      .onThirdCall()
      .returns(routesDetailsCode);

    const tree = routesService.parse();

    expect(tree).to.deep.equal([
      {
        index: 0,
        import: '@components/layouts/app',
        children: [
          { index: 0, import: '@pages/home', children: [] },
          {
            index: 1,
            import: '',
            children: [
              { index: 0, import: '@pages/details/index', children: [] },
              { index: 1, import: '@pages/details/user', children: [] },
            ],
          },
          { index: 2, import: '@pages/error-boundary', children: [] },
          { index: 3, import: '@pages/nested-suspense', children: [] },
          { index: 4, import: '@pages/redirect', children: [] },
          { index: 5, import: '@pages/redirect', children: [] },
          { index: 6, import: notLazyImport, children: [] },
          { index: 7, import: notLazyImport, children: [] },
          { index: 8, import: notLazyImport, children: [] },
          { index: 9, import: notLazyImport, children: [] },
          { index: 10, import: notLazyImport, children: [] },
        ],
      },
    ]);
  });

  it('should parse route files with static imports: element', () => {
    stubExistFiles();

    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint())
      .onSecondCall()
      .returns(routesCode2Before);

    const tree = routesService.parse();

    expect(tree).to.deep.equal([
      { index: 0, import: notLazyImport, children: [] },
      { index: 1, import: notLazyImport, children: [] },
      { index: 2, import: notLazyImport, children: [] },
      { index: 3, import: notLazyImport, children: [] },
      { index: 4, import: notLazyImport, children: [] },
    ]);
  });

  it('should parse route files with named imports', () => {
    stubExistFiles();

    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint(true, true))
      .onSecondCall().returns(`
        import NotLazyPage from '@pages/not-lazy';

        const routes: TRouteObject[] = [
          {
            element: <NotLazyPage />,
          },
        ];
        const anotherRoutes = [];

        export { routes, anotherRoutes };
      `);

    const tree = routesService.parse();

    expect(tree).to.deep.equal([{ index: 0, import: '@pages/not-lazy', children: [] }]);
  });

  describe.each(arrayWrappers)('%s', (_name, prefix, suffix) => {
    it.each(['variable', 'named', 'default'])(
      'should parse a %s export and nested children',
      (kind) => {
        stubExistFiles();
        const array = `${prefix}[
        { Component: NotLazyPage },
        { children: ${prefix}${childRoutes}${suffix} },
      ]${suffix}`;
        const declaration =
          kind === 'default'
            ? `export default ${array};`
            : `const routes = ${array}; export ${kind === 'named' ? '{ routes }' : 'default routes'};`;
        sandbox
          .stub(fs, 'readFileSync')
          .onFirstCall()
          .returns(clientEntrypoint(false, kind === 'named'))
          .onSecondCall()
          .returns(`${routeImports}${declaration}`);

        expect(JSON.stringify(routesService.parse())).toBe(
          JSON.stringify([
            { index: 0, import: notLazyImport, children: [] },
            {
              index: 1,
              import: '',
              children: [
                { index: 0, import: notLazyImport, children: [] },
                { index: 1, import: '@pages/home', children: [] },
              ],
            },
          ]),
        );
      },
    );

    it.each([true, false])(
      'should preserve route transforms with path IDs enabled: %s',
      (withPathId) => {
        const plain = `${routeImports}const routes = [{ children: ${childRoutes} }];`;
        const wrapped = `${routeImports}const routes = ${prefix}[
        { children: ${prefix}${childRoutes}${suffix} }
      ]${suffix};`;
        const expected = ParseRoutes.handleRoutes(plain, withPathId);
        const actual = ParseRoutes.handleRoutes(wrapped, withPathId);

        expect(actual.match(/pathId: "[^"]+"/g)).toEqual(expected.match(/pathId: "[^"]+"/g));
        expect(actual.match(/lazy: n\(\(\) => import\('[^']+'\)\)/g)).toEqual([
          "lazy: n(() => import('@pages/home'))",
        ]);
        expect(actual.match(/import n from/g)).toHaveLength(1);
      },
    );
  });

  it.each([
    ['TSTypeAssertion', '<TRouteObject[]>'],
    ['ParenthesizedExpression', ''],
  ])('should parse an explicit %s AST node', (nodeType, assertion) => {
    stubExistFiles();
    // JSX parsing normally represents parentheses as metadata and disallows angle assertions.
    const code = `${routeImports}const routes = (${assertion}${childRoutes}); export default routes;`;
    const ast = parse(code, {
      sourceType: 'module',
      createImportExpressions: true,
      createParenthesizedExpressions: true,
      plugins: ['typescript'],
    });
    const initializer = ast.program.body.find((node) => node.type === 'VariableDeclaration')
      ?.declarations[0].init;
    expect(initializer?.type).toBe('ParenthesizedExpression');
    if (initializer?.type === 'ParenthesizedExpression') {
      expect(initializer.expression.type).toBe(assertion ? nodeType : 'ArrayExpression');
    }
    const routesParser = routesService as unknown as {
      parseFile: (filename: string) => ReturnType<typeof parse> | null;
    };
    sandbox
      .stub(routesParser, 'parseFile')
      .onFirstCall()
      .returns(parse(clientEntrypoint(), { sourceType: 'module' }))
      .onSecondCall()
      .returns(ast);

    expect(routesService.parse()).toEqual([
      { index: 0, import: notLazyImport, children: [] },
      { index: 1, import: '@pages/home', children: [] },
    ]);
  });

  it('should parse wrappers in imported children route files', () => {
    stubExistFiles();
    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint())
      .onSecondCall()
      .returns(
        `
        import children from './details';
        const routes = [{ children }] satisfies TRouteObject[];
        export default routes;
      `,
      )
      .onThirdCall()
      .returns(`${routeImports}export default (${childRoutes} as const);`);

    expect(routesService.parse()).toEqual([
      {
        index: 0,
        import: '',
        children: [
          { index: 0, import: notLazyImport, children: [] },
          { index: 1, import: '@pages/home', children: [] },
        ],
      },
    ]);
  });

  it.each([
    ['const routes = makeRoutes(); export default routes;', 'CallExpression'],
    ['const routes = ({} as TRouteObject[])!; export default routes;', 'ObjectExpression'],
    ['const routes = otherRoutes satisfies TRouteObject[]; export default routes;', 'Identifier'],
    ['let routes; export default routes;', 'undefined'],
  ])('should report the file and unwrapped node type for %s', (code, nodeType) => {
    stubExistFiles();
    const warnStub = sandbox.stub(serverConfig.getLogger(), 'warn');
    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint())
      .onSecondCall()
      .returns(code);

    expect(() => routesService.parse()).toThrow(
      `Expected routes array in /src/routes/index.js, received ${nodeType}.`,
    );
    expect(warnStub.called).toBe(false);
  });

  it.each([
    ['export default createRoutes();', 'CallExpression'],
    ['export default {} satisfies TRouteObject[];', 'ObjectExpression'],
  ])('should warn once and return an empty result for %s', (code, nodeType) => {
    stubExistFiles();
    const warnStub = sandbox.stub(serverConfig.getLogger(), 'warn');
    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(clientEntrypoint())
      .onSecondCall()
      .returns(code);

    expect(routesService.parse()).toEqual([]);
    expect(
      warnStub.calledOnceWithExactly(
        `Routes manifest: default export of /src/routes/index.js is a ${nodeType} and cannot be analyzed; lazy route assets will not be injected.`,
      ),
    ).toBe(true);
  });
});
