// @vitest-environment node
import fs from 'fs';
import childProcess from 'node:child_process';
import process from 'node:process';
import { expect } from 'chai';
import sinon from 'sinon';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import BuildService from '@services/build';
import ServerConfig from '@services/server-config';
import SsrManifest from '@services/ssr-manifest';

const config = {
  pluginConfig: {
    routesParsing: 'node',
  },
  resolveConfig: {
    root: '/src',
    build: {
      outDir: 'build',
    },
    resolve: {
      alias: [],
    },
  },
};

vi.mock('@helpers/plugin-config', () => ({
  default: () => config.pluginConfig,
}));
vi.mock('vite', (importOriginal) => ({
  ...importOriginal,
  resolveConfig: () => config.resolveConfig,
}));

describe('build', () => {
  const sandbox = sinon.createSandbox();
  const createBuildStubs = () => {
    return {
      writeFileSyncStub: sandbox.stub(fs, 'writeFileSync'),
      mkdirSyncStub: sandbox.stub(fs, 'mkdirSync'),
      rmSyncStub: sandbox.stub(fs, 'rmSync'),
      unlinkSyncStub: sandbox.stub(fs, 'unlinkSync'),
      spawnStub: sandbox.stub(childProcess, 'spawn').returns({
        on: sandbox.stub().callsFake((_, resolve: CallableFunction) => {
          resolve(0);
        }),
      } as unknown as childProcess.ChildProcess),
      processOnStub: sandbox.stub(process, 'on'),
      buildRoutesManifestStub: sandbox.stub(
        SsrManifest.get(ServerConfig.init()),
        'buildRoutesManifest',
      ),
    };
  };

  beforeEach(() => {
    sandbox.stub(console, 'info');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should success build application', async () => {
    const service = new BuildService({ mode: 'production' });

    const { buildRoutesManifestStub } = createBuildStubs();

    await service.build();

    // should call build manifest for server side package
    expect(buildRoutesManifestStub).to.be.calledOnce;
  });
});
