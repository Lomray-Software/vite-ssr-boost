import chalk from 'chalk';
import type { ICliContext } from '@constants/cli-context';
import processStop from '@helpers/process-stop';
import type { IPluginOptions } from '../plugin';

/**
 * Stop server
 */
const stopServer = async ({ server, config }: ICliContext): Promise<boolean> => {
  const Logger = config?.getLogger();

  // stop express server
  const err = await new Promise((resolve) => {
    server?.close(resolve);
  });

  // stop vite server
  await config?.getVite()?.close();

  if (err) {
    Logger?.info(chalk.red(`failed to stop dev server: ${err as string}`));

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
