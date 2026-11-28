import chalk from 'chalk';
import type { ICliContext } from '@constants/cli-context';
import { describeError, logSafely } from '@helpers/log-safely';
import processStop from '@helpers/process-stop';
import type { IPluginOptions } from '../plugin';

/**
 * How long each phase of a stop without a lifecycle may take, as the lifecycle drain per phase
 */
const STOP_PHASE_TIMEOUT_MS = 30000;

/**
 * Write a shortcut status line as a best effort: the logger is read at the time of the write and
 * the console takes the line when there is no logger or it fails
 */
const reportStatus = (
  config: ICliContext['config'],
  message: string,
  paint: (text: string) => string,
): void => {
  logSafely(
    () => config?.getLogger(),
    (logger) => logger.info(paint(message)),
    message,
  );
};

/**
 * Report a failed stop as a best effort, so a failing logger cannot replace the failed result
 */
const reportStopFailure = (config: ICliContext['config'], error: unknown): void => {
  reportStatus(config, `failed to stop dev server: ${describeError(error)}`, chalk.red);
};

/**
 * Settle a stop phase within its deadline: a phase that outlives it counts as a failed stop, and
 * the timer is cleared once the phase settles so it never holds the process
 */
const settleWithin = <T>(phase: () => Promise<T>, name: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${name} timed out after ${STOP_PHASE_TIMEOUT_MS} ms`)),
      STOP_PHASE_TIMEOUT_MS,
    );
  });

  return Promise.race([Promise.resolve().then(phase), deadline]).finally(() => clearTimeout(timer));
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

  // stop express server: a close that throws, reports an error or outlives its deadline still
  // lets vite close
  if (server) {
    try {
      const serverError = await settleWithin(
        () =>
          new Promise((resolve) => {
            server.close(resolve);
          }),
        'server close',
      );

      if (serverError) {
        failure = { error: serverError };
      }
    } catch (error) {
      failure = { error };
    }
  }

  // stop vite server, also after a failed server close, within its own deadline
  try {
    await settleWithin(async () => config?.getVite()?.close(), 'vite close');
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
