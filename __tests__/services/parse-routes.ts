import fs from 'fs';
import path from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import { afterEach, describe, it } from 'vitest';
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
    expect(() => routesService.parse()).to.throw('Unable to find routes file');
  });

  it('should not find routes import in client entrypoint and throw error', () => {
    sandbox.stub(fs, 'readFileSync').returns(`
    import entryClient from '@lomray/vite-ssr-boost/browser/entry';

    void entryClient(App, routes, {});
    `);

    expect(() => routesService.parse()).to.throw('Unable to find routes file');
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
});
