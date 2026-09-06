import fs from 'node:fs';
import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import PathNormalize from '@services/path-normalize';

describe('PathNormalize', () => {
  const sandbox = sinon.createSandbox();
  const config = {
    getParams: () => ({ root: '/project-root' }),
    getVite: () => undefined,
  };

  afterEach(() => {
    sandbox.restore();
  });

  it('should return only string aliases', () => {
    const service = new PathNormalize(config as never, [
      { find: '@pages', replacement: '/project-root/src/pages' },
      { find: /regexp/, replacement: '/ignored' },
    ]);

    expect(service.getAliases()).toEqual({
      '@pages': '/project-root/src/pages',
    });
  });

  it('should return import postfixes', () => {
    const service = new PathNormalize(config as never, []);

    expect(service.getImportPostfix()).toEqual([
      '',
      '.js',
      '.ts',
      '.tsx',
      '.jsx',
      '.mjs',
      '.mts',
      '/index',
      '/index.js',
      '/index.ts',
      '/index.tsx',
      '/index.jsx',
      '/index.mjs',
      '/index.mts',
    ]);
  });

  it('should resolve relative and alias app paths', () => {
    const service = new PathNormalize(config as never, [
      { find: '@pages', replacement: '/project-root/src/pages' },
    ]);

    expect(service.getAppPath('./src/app.tsx', true)).toBe('/project-root/src/app.tsx');
    expect(service.getAppPath('@pages/home')).toBe('src/pages/home');
  });

  it('should normalize root path and return undefined for empty input', () => {
    const service = new PathNormalize(config as never, []);

    expect(service.getAppPath('/project-root/src/app.tsx')).toBe('src/app.tsx');
    expect(service.getAppPath(undefined)).toBeUndefined();
  });

  it('should find first existing app file', () => {
    sandbox.stub(fs, 'existsSync').callsFake((filepath) => filepath === '/base/path.ts');
    sandbox.stub(fs, 'statSync').returns({
      isFile: () => true,
    } as never);

    const service = new PathNormalize(config as never, []);

    expect(service.findAppFile('/base/path')).toBe('/base/path.ts');
  });

  it('should return null when app file is not found', () => {
    sandbox.stub(fs, 'existsSync').returns(false);

    const service = new PathNormalize(config as never, []);

    expect(service.findAppFile('/base/path')).toBeNull();
  });
});
