import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import type { ResolvedConfig } from 'vite';
import { afterEach, describe, it } from 'vitest';
import { createDevMarker, getMarkerFile } from '@helpers/dev-marker';

const root = '/project-root';
const buildConf = { outDir: 'build' };
const resolvedConfig = { root, build: buildConf } as ResolvedConfig;

describe('createDevMarker', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should create dev marker in development mode', () => {
    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(false);
    const mkdirSyncStub = sandbox.stub(fs, 'mkdirSync');
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');

    createDevMarker(false, resolvedConfig);

    expect(existsSyncStub.calledWith(path.resolve(root, `${buildConf.outDir}/server`))).to.be.true;
    expect(
      mkdirSyncStub.calledWith(path.resolve(root, `${buildConf.outDir}/server`), {
        recursive: true,
      }),
    ).to.be.true;
    expect(writeFileSyncStub.calledWith(path.resolve(root, `${buildConf.outDir}/server/.dev`))).to
      .be.true;

    existsSyncStub.restore();
    mkdirSyncStub.restore();
    writeFileSyncStub.restore();
  });

  it('should remove dev marker in production mode', () => {
    const isProd = true;

    const existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);
    const rmSyncStub = sandbox.stub(fs, 'rmSync');

    createDevMarker(isProd, resolvedConfig);

    expect(existsSyncStub.calledWith(path.resolve(root, `${buildConf.outDir}/server/.dev`))).to.be
      .true;
    expect(rmSyncStub.calledWith(path.resolve(root, `${buildConf.outDir}/server/.dev`))).to.be.true;

    existsSyncStub.restore();
    rmSyncStub.restore();
  });
});

describe('getMarkerFile', () => {
  it('should return the correct marker file path with file', () => {
    const result = getMarkerFile(root, true);

    expect(result).to.equal(`${root}/server/.dev`);
  });

  it('should return the correct marker file path without file', () => {
    const result = getMarkerFile(root, false);

    expect(result).to.equal(`${root}/server`);
  });
});
