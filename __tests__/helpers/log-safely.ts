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
    const write = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(write, 'fallback');

    expect(write).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('should fall back to the console when the logger throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSafely(() => {
      throw new Error('no logger');
    }, 'fallback');

    expect(consoleError).toHaveBeenCalledExactlyOnceWith('fallback');
  });

  it('should not throw when the console fails as well', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('no console');
    });

    expect(() =>
      logSafely(() => {
        throw new Error('no logger');
      }, 'fallback'),
    ).not.toThrow();
  });
});
