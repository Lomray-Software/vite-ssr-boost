// @vitest-environment node
import fs from 'fs';
import { expect } from 'chai';
import sinon from 'sinon';
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest';
import { compiledRoutesCode1After, compiledRoutesCode1Before } from '@__mocks__/route-file';
import BuildService from '@services/build';
import ServerConfig from '@services/server-config';
import SsrManifest from '@services/ssr-manifest';

vi.mock('@helpers/plugin-config', () => ({
  default: () => ({}),
}));

describe('build', () => {
  const sandbox = sinon.createSandbox();
  const service = new BuildService({ mode: 'production' });

  beforeAll(async () => {
    await service.makeConfig();
  });

  beforeEach(() => {
    sandbox.stub(console, 'info');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should build routes manifest', async () => {
    const serverConfig = ServerConfig.init();
    const buildRoutesManifestStub = sandbox.stub(
      SsrManifest.get(serverConfig),
      'buildRoutesManifest',
    );
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');

    sandbox
      .stub(fs, 'readFileSync')
      .onFirstCall()
      .returns(JSON.stringify({ routeFiles: { 'app.ts': 'app.js' } }))
      .onSecondCall()
      .returns(compiledRoutesCode1Before);

    await service.buildManifest();

    const [, data] = writeFileSyncStub.firstCall.args;

    expect(buildRoutesManifestStub).to.be.calledOnce;
    expect(data).to.be.equal(compiledRoutesCode1After);
  });
});
