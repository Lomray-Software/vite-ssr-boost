import type { ISsrExecutionContext } from '@core/types';

const emitEarlyHints = async (
  context: ISsrExecutionContext | undefined,
  headers: Headers,
): Promise<void> => {
  await context?.earlyHints?.(headers);
};

export default emitEarlyHints;
