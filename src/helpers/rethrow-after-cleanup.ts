import type { IErrorLogger } from '@node/server-kit';

/**
 * Run the cleanup of a failed start, then throw the failure; a cleanup error is only logged.
 */
const rethrowAfterCleanup = async (
  failure: unknown,
  cleanup: () => unknown,
  logger: IErrorLogger,
): Promise<never> => {
  try {
    await cleanup();
  } catch (error) {
    try {
      logger.error(`Cleanup after a failed start failed: ${(error as Error)?.message}`, {
        error: error as Error,
      });
    } catch {
      // The start failure is what the caller must see, even when logging fails.
    }
  }

  throw failure;
};

export default rethrowAfterCleanup;
