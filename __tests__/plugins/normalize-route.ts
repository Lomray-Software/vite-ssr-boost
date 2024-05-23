import fs from 'node:fs';
import { expect } from 'chai';
import sinon from 'sinon';
import { afterEach, describe, it } from 'vitest';
import {
  routesCode1Before,
  routesCode1After,
  routesCode2Before,
  routesCode2After,
  routesCode3Before,
  routesCode3After,
  routesCodeLazyBefore,
  routesCodeLazyAfter,
  routesCode4Before,
  routesCode4After,
} from '@__mocks__/route-file';
import normalizeRoute from '@plugins/normalize-route';

type TSimpleTransform = (code: string, id: string) => undefined | { code: string };

describe('normalizeRoute', () => {
  const sandbox = sinon.createSandbox();
  const allowedFileId = '/src/routes/index.ts';

  afterEach(() => {
    sandbox.restore();
  });

  /**
   * Return transform function
   */
  const getTransform = (...params: Parameters<typeof normalizeRoute>) =>
    normalizeRoute(...params).transform as TSimpleTransform;

  it('should return routes with injected pathId: lazy, Component', () => {
    const result = getTransform({ isSSR: true })(routesCode1Before, allowedFileId);

    expect(result?.code).to.equal(routesCode1After);
  });

  it('should return routes with injected pathId: element,Component', () => {
    const result = getTransform()(routesCode2Before, allowedFileId);

    expect(result?.code).to.equal(routesCode2After);
  });

  it('should return routes with injected pathId formatting: element,Component', () => {
    const result = getTransform()(routesCode3Before, allowedFileId);

    expect(result?.code).to.equal(routesCode3After);
  });

  it('should return original routes', () => {
    const result = getTransform()(routesCode4Before, allowedFileId);

    expect(result?.code).to.equal(routesCode4After);
  });

  it('should return routes with injected pathId - NO SSR: lazy', () => {
    const result = getTransform()(routesCodeLazyBefore, allowedFileId);

    expect(result?.code).to.equal(routesCodeLazyAfter);
  });

  it('should return not modified code: build mode', () => {
    const result = getTransform({ isBuild: true })(routesCode2Before, allowedFileId);

    expect(result?.code).to.equal(routesCode2Before);
  });

  it('should skip transform file: different routesPath', () => {
    const result = getTransform({ routesPath: '/another-folder/' })(
      routesCode2Before,
      allowedFileId,
    );

    expect(result).to.be.undefined;
  });

  it('should return the original code when importPath is not defined', () => {
    const code = `
      const routes = [
        { path: '/', Component: Home },
        { path: '/about', Component: About },
      ];
    `;

    const result = getTransform()(code, allowedFileId);

    expect(result?.code).to.equal(code);
  });

  it('should set config & get transformed route & write metadata', () => {
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    const plugin = normalizeRoute({ isSSR: true });
    const bundle = {
      '/assets/index-JDj23ja.js': {
        type: 'chunk',
        modules: { [allowedFileId]: 'test' },
      },
      '/assets/index-Jx9999.js': {
        type: 'chunk',
        modules: { '/': 'test' },
      },
    };

    // @ts-expect-error ignore error, we know config type
    plugin.transform(routesCode1Before, allowedFileId);
    // @ts-expect-error ignore error, we know config type
    plugin.generateBundle?.({}, bundle);
    // @ts-expect-error ignore error, we know config type
    plugin.config?.({ root: '/src', build: { outDir: '/build/client' } }, { isSsrBuild: false });
    // @ts-expect-error ignore error, we know config type
    plugin.writeBundle?.();

    const [, data] = writeFileSyncStub.firstCall.args;

    expect(JSON.parse(data as string)).to.deep.equal({
      routeFiles: {
        [allowedFileId]: Object.keys(bundle)[0],
      },
    });
  });

  it('should ignore set config & write metadata', () => {
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    const plugin = normalizeRoute({ isSSR: true });

    // @ts-expect-error ignore error, we know config type
    plugin.config?.({ root: '/src', build: { outDir: '/build/client' } }, { isSsrBuild: true });
    // @ts-expect-error ignore error, we know config type
    plugin.writeBundle?.();

    expect(writeFileSyncStub).to.not.called;
  });
});
