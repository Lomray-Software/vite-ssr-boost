import { expect } from 'chai';
import type { SinonStub } from 'sinon';
import sinon from 'sinon';
import { describe, it, afterEach, beforeEach } from 'vitest';
import processStop from '@helpers/process-stop';

describe('processStop', () => {
  const sandbox = sinon.createSandbox();
  let exitStub: SinonStub;

  beforeEach(() => {
    exitStub = sandbox.stub(process, 'exit');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should exit with code 0 by default', () => {
    processStop();

    expect(exitStub.calledOnceWithExactly(0)).to.be.true;
  });

  it('should exit with the specified code', () => {
    const exitCode = 123;

    processStop(exitCode);

    expect(exitStub.calledOnceWithExactly(exitCode)).to.be.true;
  });

  it('should exit with code 1 when a non-zero string code is provided', () => {
    const errorMessage = 'Some error message';
    const consoleErrorStub = sinon.stub(console, 'error');

    processStop(errorMessage);

    expect(exitStub.calledOnceWithExactly(1)).to.be.true;
    expect(consoleErrorStub.calledOnceWithExactly(errorMessage)).to.be.true;
  });

  it('should not exit with code 0 when isOnlyError is true and code is 0 or null', () => {
    processStop(0, true);
    expect(exitStub.called).to.be.false;

    processStop(null, true);
    expect(exitStub.called).to.be.false;
  });
});
