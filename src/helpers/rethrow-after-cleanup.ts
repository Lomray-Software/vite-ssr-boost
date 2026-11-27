import type { Logger } from 'vite';

/**
 * Run the cleanup of a failed start, then throw the failure; a cleanup error is only logged.
 */
const rethrowAfterCleanup = async (
  failure: unknown,
  cleanup: () => unknown,
  logger: Pick<Logger, 'error'>,
): Promise<never> => {
  try {
    await cleanup();
  } catch (error) {
    logger.error(`Cleanup after a failed start failed: ${(error as Error)?.message}`, {
      error: error as Error,
    });
  }

  throw failure;
};

export default rethrowAfterCleanup;
