/**
 * Describe a thrown value as text without throwing, whatever was thrown.
 */
const describeError = (error: unknown): string => {
  try {
    const message = (error as { message?: unknown } | null | undefined)?.message;

    if (typeof message === 'string') {
      return message;
    }
  } catch {
    // a throwing message getter still leaves the value's own text to try
  }

  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
};

/**
 * Write the fallback to the console without throwing.
 */
const writeFallback = (fallback: string): void => {
  try {
    console.error(fallback);
  } catch {
    // both outputs failed, so the diagnostic has nowhere left to go
  }
};

/**
 * Write a diagnostic as a best effort: the logger is read at the time of the write, and a failing
 * or absent logger falls back to the console. Whatever the write returns is ignored, so a logger
 * method that returns a value is never taken for a missing logger. The diagnostic never replaces
 * the result of the work it reports on.
 */
const logSafely = <TLogger>(
  readLogger: () => TLogger | null | undefined,
  write: (logger: TLogger) => unknown,
  fallback: string,
): void => {
  try {
    const logger = readLogger();

    if (logger) {
      write(logger);

      return;
    }
  } catch {
    // a logger that cannot be read or written leaves the console to take the line
  }

  writeFallback(fallback);
};

export { describeError, logSafely };
