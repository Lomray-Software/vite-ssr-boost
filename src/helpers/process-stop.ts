import process from 'node:process';

/**
 * Stop node process
 */
const processStop = (code = 0, isOnlyError = false) => {
  if (isOnlyError && code === 0) {
    return;
  }

  process.exit(code);
};

export default processStop;
