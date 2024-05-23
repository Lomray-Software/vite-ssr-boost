import fs from 'node:fs';
import { expect } from 'chai';
import sinon from 'sinon';
import { afterEach, describe, it } from 'vitest';
import { writeMeta, readMeta, removeMeta } from '@helpers/ssr-meta';

const buildDir = '/build';
const dataFile = `${buildDir}/meta.json`;

describe('ssr-meta', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should write metadata to the meta.json file', () => {
    const newMeta = { routeFiles: { 'app.ts': 'app.js' } };
    const writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');

    writeMeta(buildDir, newMeta);

    const [file, data] = writeFileSyncStub.firstCall.args;

    expect(file).to.eq(dataFile);
    expect(JSON.parse(data as string)).to.deep.eq(newMeta);
  });

  it('should read metadata from the meta.json file', () => {
    const testData = { test: 'data' };
    const readFileSyncStub = sandbox.stub(fs, 'readFileSync').returns(JSON.stringify(testData));

    const res = readMeta(buildDir);

    expect(readFileSyncStub).to.calledWith(dataFile);
    expect(res).to.deep.eq(testData);
  });

  it('should return an empty object if the meta.json file does not exist', () => {
    const readFileSyncStub = sandbox.stub(fs, 'readFileSync').throws();

    const res = readMeta(buildDir);

    expect(readFileSyncStub).to.calledWith(`${buildDir}/meta.json`);
    expect(res).to.deep.eq({});
  });

  it('should remove the meta.json file', () => {
    const unlinkSyncStub = sandbox.stub(fs, 'unlinkSync');

    removeMeta(buildDir);

    expect(unlinkSyncStub).to.calledWith(dataFile);
  });

  it('should not throw if the meta.json file does not exist', () => {
    const unlinkSyncStub = sandbox.stub(fs, 'unlinkSync').throws();

    removeMeta(buildDir);

    expect(unlinkSyncStub).to.calledWith(dataFile).and.not.throws;
  });
});
