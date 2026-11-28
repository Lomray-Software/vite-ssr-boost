import chalk from 'chalk';
import type { ICliContext } from '@constants/cli-context';
import processStop from '@helpers/process-stop';
import type { IPluginOptions } from '../plugin';

/**
 * Stop server
 */
const stopServer = async ({ server, config, lifecycle }: ICliContext): Promise<boolean> => {
  // drain through the lifecycle: it closes the server and the dev Vite instance
  if (lifecycle) {
    try {
      await lifecycle.close();

      return true;
    } catch (error) {
      // the logger is read only to report, so a failing read cannot block the drain
      config?.getLogger()?.info(chalk.red(`failed to stop dev server: ${error as string}`));

      return false;
    }
  }

  // stop express server
  const err = await new Promise((resolve) => {
    server?.close(resolve);
  });

  // stop vite server
  await config?.getVite()?.close();

  if (err) {
    config?.getLogger()?.info(chalk.red(`failed to stop dev server: ${err as string}`));

    return false;
  }

  return true;
};

/**
 * Default plugin shortcuts
 */
const shortcuts: NonNullable<IPluginOptions['customShortcuts']> = [
  {
    key: 'r',
    description: 'restart server',
    action: async (cliContext) => {
      const { reboot, config } = cliContext;
      const Logger = config?.getLogger();

      Logger?.info(chalk.yellow('\nrestarting server...'));

      if (!(await stopServer(cliContext))) {
        return;
      }

      // a termination signal arrived during the drain: the process is exiting, do not boot again
      if (cliContext.isExiting) {
        return;
      }

      await reboot?.(false);
      Logger?.info(chalk.green('server restarted successful.'));
    },
  },
  {
    key: 'u',
    description: 'show server url',
    action({ config }) {
      config?.getLogger()?.info('');
      config?.getVite()?.printUrls();
    },
  },
  {
    key: 'c',
    description: 'clear console',
    isOnlyDev: true,
    action({ config }) {
      config?.getLogger()?.clearScreen('error');
    },
  },
  {
    key: 'o',
    description: 'open in browser',
    isOnlyDev: true,
    action({ config }) {
      config?.getVite()?.openBrowser();
    },
  },
  {
    key: 'q',
    description: 'quit',
    async action(cliContext) {
      await stopServer(cliContext);
      processStop();
    },
  },
];

export default shortcuts;
