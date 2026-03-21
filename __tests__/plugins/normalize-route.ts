import fs from 'node:fs';
import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
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
  routesCode5Before,
  routesCode5After,
  routesCodeLazyAfterClean,
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

  it('should return routes without injected pathId: lazy, Component', () => {
    const result = getTransform({ isSSR: true, isBuild: true })(
      routesCodeLazyBefore,
      allowedFileId,
    );

    expect(result?.code).to.equal(routesCodeLazyAfterClean);
  });

  it('should return routes with injected pathId (development mode): lazy, Component', () => {
    const result = getTransform({ isSSR: true, isBuild: false })(routesCode2Before, allowedFileId);

    expect(result?.code).to.equal(routesCode2After);
  });

  it('should return routes with injected pathId: element,Component', () => {
    const result = getTransform({ isSSR: true })(routesCode2Before, allowedFileId);

    expect(result?.code).to.equal(routesCode2After);
  });

  it('should return routes with injected pathId formatting: element,Component', () => {
    const result = getTransform({ isSSR: true })(routesCode3Before, allowedFileId);

    expect(result?.code).to.equal(routesCode3After);
  });

  it('should return original routes', () => {
    const result = getTransform({ isSSR: true })(routesCode4Before, allowedFileId);

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

    expect(result).toBeUndefined();
  });

  it('should return the original code when importPath is not defined', () => {
    const code = `
const routes = [
{ path: '/', Component: Home },
{ path: '/about', Component: About }];`;

    const result = getTransform()(code, allowedFileId);

    expect(result?.code).to.equal(code);
  });

  it('should ignore set config & write metadata', () => {
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    const plugin = normalizeRoute({ isSSR: true });

    // @ts-expect-error ignore error, we know config type
    plugin.config?.({ root: '/src', build: { outDir: '/build/client' } }, { isSsrBuild: true });
    // @ts-expect-error ignore error, we know config type
    plugin.writeBundle?.();

    expect(writeFileSyncStub.called).toBe(false);
  });

  it('should return routes with injected pathId: Components has JSX props', () => {
    const result = getTransform({ isSSR: true })(routesCode5Before, allowedFileId);

    expect(result?.code).to.equal(routesCode5After);
  });
});
