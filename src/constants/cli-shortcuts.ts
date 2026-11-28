import chalk from 'chalk';
import type { ICliContext } from '@constants/cli-context';
import { describeError, logSafely } from '@helpers/log-safely';
import processStop from '@helpers/process-stop';
import type { IPluginOptions } from '../plugin';

/**
 * Report a failed stop as a best effort, so a failing logger cannot replace the failed result
 */
const reportStopFailure = (config: ICliContext['config'], error: unknown): void => {
  const message = `failed to stop dev server: ${describeError(error)}`;

  logSafely(() => config?.getLogger()?.info(chalk.red(message)), message);
};

/**
 * Write a shortcut status line as a best effort: the logger is read at the time of the write
 */
const reportStatus = (
  config: ICliContext['config'],
  message: string,
  paint: (text: string) => string,
): void => {
  logSafely(() => config?.getLogger()?.info(paint(message)), message);
};

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
      reportStopFailure(config, error);

      return false;
    }
  }

  // the first failure wins; kept apart from its value so even a thrown undefined counts
  let failure: { error: unknown } | undefined;

  // stop express server: a close that throws or reports an error still lets vite close
  if (server) {
    try {
      const serverError = await new Promise((resolve) => {
        server.close(resolve);
      });

      if (serverError) {
        failure = { error: serverError };
      }
    } catch (error) {
      failure = { error };
    }
  }

  // stop vite server, also after a failed server close
  try {
    await config?.getVite()?.close();
  } catch (error) {
    if (!failure) {
      failure = { error };
    }
  }

  if (failure) {
    reportStopFailure(config, failure.error);

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

      reportStatus(config, '\nrestarting server...', chalk.yellow);

      if (!(await stopServer(cliContext))) {
        return;
      }

      // a termination signal arrived during the drain: the process is exiting, do not boot again
      if (cliContext.isExiting) {
        return;
      }

      await reboot?.(false);
      reportStatus(config, 'server restarted successful.', chalk.green);
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
