import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import loadProductionConfig from '@services/production-config';

describe('production build configuration', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-boost-config-'));
    fs.mkdirSync(path.join(directory, 'server'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('resolves serving paths from a relocated build without source configuration', () => {
    const config = {
      version: 1,
      root: '..',
      base: '/store/',
      mode: 'staging',
      publicDir: 'client',
      indexFile: 'client/shop.html',
      serverFile: 'server/shop.js',
    };

    fs.writeFileSync(path.join(directory, 'server/ssr-boost.json'), JSON.stringify(config));

    expect(loadProductionConfig(directory)).toEqual({ ...config, root: directory });
  });

  it('retains the conventional-path fallback for older builds', () => {
    expect(loadProductionConfig(directory)).toBeUndefined();
  });

  it.each([null, { version: 2 }, { version: 1, root: 123 }])('rejects an incompatible build descriptor', (config) => {
    fs.writeFileSync(path.join(directory, 'server/ssr-boost.json'), JSON.stringify(config));

    expect(() => loadProductionConfig(directory)).toThrow('Run ssr-boost build again.');
  });

  it('does not silently fall back when the descriptor is corrupt', () => {
    fs.writeFileSync(path.join(directory, 'server/ssr-boost.json'), '{');

    expect(() => loadProductionConfig(directory)).toThrow(SyntaxError);
  });
});
