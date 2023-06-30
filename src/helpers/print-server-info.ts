import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import CliActions from '@constants/cli-actions';
import cliName from '@constants/cli-name';
import printServerUrls from '@helpers/print-server-urls';
import resolveServerUrls from '@helpers/resolve-server-urls';
import type ServerConfig from '@services/server-config';

interface IPrintServerInfoParams {
  version?: string;
}

/**
 * Print server info
 */
async function printServerInfo(
  server: Server,
  config: ServerConfig,
  { version = 'unknown' }: IPrintServerInfoParams,
): Promise<void> {
  const { action } = config.getPluginConfig() ?? {};
  const { isProd, host } = config.getParams();

  const Logger = config.getLogger();
  const perfStart = global.viteBoostStartTime ?? performance.now();
  const startupDurationString = chalk.dim(
    `ready in ${chalk.reset(chalk.bold(Math.ceil(performance.now() - perfStart)))} ms`,
  );

  Logger.info(
    `\n  ${chalk.green(
      `${chalk.bold(cliName.toUpperCase())} v${version}${isProd ? chalk.blue(' PRODUCTION') : ''}`,
    )}  ${startupDurationString}\n`,
    { clear: !Logger.hasWarned },
  );

  const viteConfig = config.getVite()?.config;
  const resolvedUrls = await resolveServerUrls(server, {
    host,
    isHttps: typeof viteConfig?.server.https === 'boolean' ? viteConfig?.server.https : false,
    rawBase: viteConfig?.['rawBase'],
  });

  if (!isProd) {
    const vite = config.getVite()!;

    vite.resolvedUrls = resolvedUrls;
    vite.printUrls();
  } else {
    printServerUrls(resolvedUrls, (msg) => Logger.info(msg));
  }

  if (action === CliActions.dev) {
    Logger.info(
      chalk.dim(chalk.green('  ➜')) +
        chalk.dim('  press ') +
        chalk.bold('h') +
        chalk.dim(' to show help'),
    );
  }
}

export default printServerInfo;
