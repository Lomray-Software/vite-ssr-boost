import process from 'node:process';

/**
 * Stop node process
 */
const processStop = (code: number | string | null = 0, isOnlyError = false): void => {
  if (isOnlyError && (code === 0 || code === null)) {
    return;
  }

  if (typeof code === 'string') {
    console.error(code);

    return process.exit(1);
  }

  process.exit(code === null ? 0 : code);
};

export default processStop;
