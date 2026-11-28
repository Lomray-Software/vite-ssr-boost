import { describe, expect, it, vi } from 'vitest';
import lazyLogger from '@helpers/lazy-logger';

describe('lazyLogger', () => {
  it('should not read the logger until it writes', () => {
    const read = vi.fn(() => {
      throw new Error('logger failed');
    });

    lazyLogger(read);

    expect(read).not.toHaveBeenCalled();
  });

  it('should pass the message and options to the logger read at write time', () => {
    const first = { error: vi.fn() };
    const second = { error: vi.fn() };
    let current = first;
    const logger = lazyLogger(() => current);
    const error = new Error('close failed');

    current = second;
    logger.error('cleanup failed', { error });

    expect(first.error).not.toHaveBeenCalled();
    expect(second.error).toHaveBeenCalledExactlyOnceWith('cleanup failed', { error });
  });

  it('should throw a failing read from the write', () => {
    const logger = lazyLogger(() => {
      throw new Error('logger failed');
    });

    expect(() => logger.error('cleanup failed')).toThrow('logger failed');
  });
});
