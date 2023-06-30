import process from 'node:process';

/**
 * Stop node process
 */
const processStop = (code = 0) => process.exit(code);

export default processStop;
