import sinon from 'sinon';
import { afterEach, describe, expect, it } from 'vitest';
import Logger from '@services/logger';

describe('Logger', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('should write info, warn, and error logs when level allows', () => {
    const infoStub = sandbox.stub(console, 'info');
    const warnStub = sandbox.stub(console, 'warn');
    const errorStub = sandbox.stub(console, 'error');
    const logger = new Logger();
    const error = new Error('boom');

    logger.info('info-message', {});
    logger.warn('warn-message', {});
    logger.error('error-message', { error });

    expect(infoStub.calledOnceWithExactly('info-message')).toBe(true);
    expect(warnStub.calledOnceWithExactly('warn-message')).toBe(true);
    expect(errorStub.calledOnceWithExactly('error-message', error)).toBe(true);
  });

  it('should skip logs above configured level', () => {
    const infoStub = sandbox.stub(console, 'info');
    const logger = new Logger({ logLevel: 2 });

    logger.info('info-message', {});

    expect(infoStub.called).toBe(false);
  });

  it('should skip logs filtered by custom predicate', () => {
    const warnStub = sandbox.stub(console, 'warn');
    const logger = new Logger({
      logFilter: ({ msg }) => msg === 'skip-me',
    });

    logger.warn('skip-me', {});
    logger.warn('keep-me', {});

    expect(warnStub.calledOnceWithExactly('keep-me')).toBe(true);
  });

  it('should expose no-op or default vite logger methods', () => {
    const logger = new Logger();

    expect(logger.hasErrorLogged()).toBe(false);
    expect(logger.clearScreen()).toBeUndefined();
    expect(logger.warnOnce('warn-once', {})).toBeUndefined();
  });
});
