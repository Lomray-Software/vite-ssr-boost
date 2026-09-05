import type { ISsrExecutionContext } from '@core/types';

/**
 * Emit informational headers when the runtime supports early hints.
 */
const emitEarlyHints = async (
  context: ISsrExecutionContext | undefined,
  headers: Headers,
): Promise<void> => {
  await context?.onEarlyHints?.(headers);
};

export default emitEarlyHints;
