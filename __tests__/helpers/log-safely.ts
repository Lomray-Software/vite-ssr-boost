import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError, logSafely } from '@helpers/log-safely';

describe('logSafely', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should describe an error by its message and any other value as text', () => {
    expect(describeError(new Error('close failed'))).toBe('close failed');
    expect(describeError('boom')).toBe('boom');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('should describe a value that cannot be turned into text without throwing', () => {
    expect(describeError(Object.create(null))).toBe('unknown error');
  });

  it('should describe a value as text when reading its message throws', () => {
    const error = {
      get message(): string {
        throw new Error('no message');
      },
      toString: () => 'close failed',
    };

    expect(describeError(error)).toBe('close failed');
  });

  it('should write through the logger when it works', () => {
    const info = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(
      () => ({ info }),
      (logger) => logger.info('line'),
      'fallback',
    );

    expect(info).toHaveBeenCalledExactlyOnceWith('line');
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('should not fall back when the logger write returns false', () => {
    const info = vi.fn<(line: string) => boolean>(() => false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(
      () => ({ info }),
      (logger) => logger.info('line'),
      'fallback',
    );

    expect(info).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('should fall back to the console when there is no logger', () => {
    const write = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(() => undefined, write, 'fallback');

    expect(write).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('fallback');
  });

  it('should fall back to the console when the logger cannot be read', () => {
    const write = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(
      () => {
        throw new Error('no logger');
      },
      write,
      'fallback',
    );

    expect(write).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledExactlyOnceWith('fallback');
  });

  it('should fall back to the console when the logger write throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(
      () => ({}),
      () => {
        throw new Error('write failed');
      },
      'fallback',
    );

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('fallback');
  });

  it('should not throw when the console fails as well', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('no console');
    });

    expect(() => logSafely(() => undefined, vi.fn(), 'fallback')).not.toThrow();
  });
});
