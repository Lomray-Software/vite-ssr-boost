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
 * Write a diagnostic as a best effort: a failing logger falls back to the console and never
 * replaces the result of the work the diagnostic reports on.
 */
const logSafely = (write: () => void, fallback: string): void => {
  try {
    write();
  } catch {
    try {
      console.error(fallback);
    } catch {
      // both outputs failed, so the diagnostic has nowhere left to go
    }
  }
};

export { describeError, logSafely };
