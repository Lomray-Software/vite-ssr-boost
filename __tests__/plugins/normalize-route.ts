import { expect } from 'chai';
import { describe, it } from 'vitest';
import {
  routesCode1Before,
  routesCode1After,
  routesCode2Before,
  routesCode2After,
  routesCode3Before,
  routesCode3After,
  routesCodeLazyBefore,
  routesCodeLazyAfter,
} from '@__mocks__/route-file';
import normalizeRoute from '@plugins/normalize-route';

type TSimpleTransform = (code: string, id: string) => undefined | { code: string };

describe('normalizeRoute', () => {
  const allowedFileId = '/src/routes/index.ts';

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
});
