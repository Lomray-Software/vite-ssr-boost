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
 * Write a diagnostic as a best effort: a failing or absent logger falls back to the console and
 * never replaces the result of the work the diagnostic reports on. A write returns false when it
 * had no logger to write to.
 */
const logSafely = (write: () => boolean | void, fallback: string): void => {
  let isWritten: boolean | void;

  try {
    isWritten = write();
  } catch {
    isWritten = false;
  }

  if (isWritten === false) {
    writeFallback(fallback);
  }
};

export { describeError, logSafely };
