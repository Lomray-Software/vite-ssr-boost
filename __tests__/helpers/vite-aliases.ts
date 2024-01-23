import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { expect } from 'chai';
import { describe, it } from 'vitest';
import viteAliases from '@helpers/vite-aliases';

describe('viteAliases', () => {
  const root = '/project-root';

  it('should return an array of aliases with correct find and replacement values', () => {
    const aliases: [string, string][] = [
      ['@src', './src'],
      ['@components', './src/components'],
      ['@styles', './src/styles'],
    ];

    const expectedAliases = [
      {
        find: '@src',
        replacement: fileURLToPath(
          new URL(pathToFileURL(`${root}/src`).toString(), import.meta.url),
        ),
      },
      {
        find: '@components',
        replacement: fileURLToPath(
          new URL(pathToFileURL(`${root}/src/components`).toString(), import.meta.url),
        ),
      },
      {
        find: '@styles',
        replacement: fileURLToPath(
          new URL(pathToFileURL(`${root}/src/styles`).toString(), import.meta.url),
        ),
      },
    ];

    const result = viteAliases(aliases, root);

    expect(result).to.deep.equal(expectedAliases);
  });

  it('should handle cleanupPath and remove leading "./"', () => {
    const aliases: [string, string][] = [['@src', './src']];

    const expectedAliases = [
      {
        find: '@src',
        replacement: fileURLToPath(
          new URL(pathToFileURL(`${root}/src`).toString(), import.meta.url),
        ),
      },
    ];

    const result = viteAliases(aliases, root);

    expect(result).to.deep.equal(expectedAliases);
  });

  it('should handle cleanupPath and remove duplicate slashes', () => {
    const aliases: [string, string][] = [['@src', './src//']];

    const expectedAliases = [
      {
        find: '@src',
        replacement: fileURLToPath(
          new URL(pathToFileURL(`${root}/src/`).toString(), import.meta.url),
        ),
      },
    ];

    const result = viteAliases(aliases, root);

    expect(result).to.deep.equal(expectedAliases);
  });
});
