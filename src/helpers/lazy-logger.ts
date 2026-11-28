import type { IErrorLogger } from '@node/server-kit';

/**
 * A logger that reads its target only when it writes, so a failing read stays inside the guarded
 * cleanup log of a failed start instead of replacing the start failure.
 */
const lazyLogger = (read: () => IErrorLogger): IErrorLogger => ({
  error: (message, options) => read().error(message, options),
});

export default lazyLogger;
