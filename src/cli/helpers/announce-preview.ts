import chalk from 'chalk';
import { logSafely } from '@helpers/log-safely';
import type ServerConfig from '@services/server-config';

const message = '\n  Running preview mode... \n';

/**
 * Announce preview mode after the readiness output of the listening server. It runs in a timer,
 * so the write is a best effort: a failing logger must not crash the running preview.
 */
const announcePreview = (config: ServerConfig): void => {
  setTimeout(() => {
    logSafely(() => config.getLogger().info(chalk.yellow(message)), message);
  }, 0);
};

export default announcePreview;
