import { describe, expect, it, vi } from 'vitest';
import rethrowAfterCleanup from '@helpers/rethrow-after-cleanup';

describe('rethrowAfterCleanup', () => {
  it('should rethrow the failure after a clean cleanup', async () => {
    const failure = new Error('setup failed');
    const cleanup = vi.fn(() => Promise.resolve());
    const logger = { error: vi.fn() };

    await expect(rethrowAfterCleanup(failure, cleanup, logger)).rejects.toBe(failure);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should keep the failure and log the error when cleanup rejects', async () => {
    const failure = new Error('setup failed');
    const cleanupError = new Error('close failed');
    const logger = { error: vi.fn() };

    await expect(
      rethrowAfterCleanup(failure, () => Promise.reject(cleanupError), logger),
    ).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('close failed'), {
      error: cleanupError,
    });
  });

  it('should keep the failure when cleanup throws synchronously', async () => {
    const failure = new Error('setup failed');
    const logger = { error: vi.fn() };

    await expect(
      rethrowAfterCleanup(
        failure,
        () => {
          throw new Error('sync close failed');
        },
        logger,
      ),
    ).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
