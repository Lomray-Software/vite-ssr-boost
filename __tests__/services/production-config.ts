import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import loadProductionConfig, { loadFingerprintedFiles } from '@services/production-config';

describe('production build configuration', () => {
  const originalCwd = process.cwd();
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ssr-boost-config-'));
    fs.mkdirSync(path.join(directory, 'server'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
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

  it('keeps the persisted managed server and tolerates unknown extra fields', () => {
    const config = {
      version: 1,
      root: '..',
      base: '/',
      mode: 'production',
      publicDir: 'client',
      indexFile: 'client/index.html',
      serverFile: 'server/server.js',
      managedServer: 'node',
      futureField: true,
    };

    fs.writeFileSync(path.join(directory, 'server/ssr-boost.json'), JSON.stringify(config));

    expect(loadProductionConfig(directory)).toEqual({ ...config, root: directory });
  });

  it.each([
    null,
    { version: 2 },
    { version: 1, root: 123 },
    {
      version: 1,
      root: '..',
      base: '/',
      mode: 'production',
      publicDir: 'client',
      indexFile: 'client/index.html',
      serverFile: 'server/server.js',
      managedServer: 'fastify',
    },
  ])('rejects an incompatible build descriptor', (config) => {
    fs.writeFileSync(path.join(directory, 'server/ssr-boost.json'), JSON.stringify(config));

    expect(() => loadProductionConfig(directory)).toThrow('Run ssr-boost build again.');
  });

  it('uses an explicit build directory alone instead of a conventional one', () => {
    const config = {
      version: 1,
      root: '..',
      base: '/',
      mode: 'production',
      publicDir: 'client',
      indexFile: 'client/index.html',
      serverFile: 'server/server.js',
    };

    fs.mkdirSync(path.join(directory, 'build/server'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'build/server/ssr-boost.json'), JSON.stringify(config));
    process.chdir(directory);

    expect(() => loadProductionConfig('missing')).toThrow(
      `Build directory not found: ${path.join(fs.realpathSync(directory), 'missing')}`,
    );
    expect(loadProductionConfig()).toEqual({
      ...config,
      root: path.join(fs.realpathSync(directory), 'build'),
    });
  });

  it('does not silently fall back when the descriptor is corrupt', () => {
    fs.writeFileSync(path.join(directory, 'server/ssr-boost.json'), '{');

    expect(() => loadProductionConfig(directory)).toThrow(SyntaxError);
  });

  it('reads the hashed client files a build listed and tolerates older builds without one', () => {
    expect(loadFingerprintedFiles(directory)).toBeUndefined();

    fs.writeFileSync(
      path.join(directory, 'server/fingerprinted-files.json'),
      JSON.stringify(['assets/app-AbCd1234.js']),
    );

    expect(loadFingerprintedFiles(directory)).toEqual(['assets/app-AbCd1234.js']);

    fs.writeFileSync(path.join(directory, 'server/fingerprinted-files.json'), '{"a":1}');

    expect(() => loadFingerprintedFiles(directory)).toThrow('Invalid fingerprinted files list');
  });
});
