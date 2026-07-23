import type { ISsrExecutionContext } from '@core/types';

const emitEarlyHints = async (
  context: ISsrExecutionContext | undefined,
  headers: Headers,
): Promise<void> => {
  await context?.onEarlyHints?.(headers);
};

export default emitEarlyHints;
