import fs from 'node:fs';
import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import type { ResolvedConfig, ViteDevServer } from 'vite';
import CliActions from '@constants/cli-actions';
import cliName from '@constants/cli-name';
import { getMarkerFile } from '@helpers/dev-marker';
import { describeError, logSafely } from '@helpers/log-safely';
import printServerUrls from '@helpers/print-server-urls';
import resolveServerUrls from '@helpers/resolve-server-urls';
import type ServerConfig from '@services/server-config';

interface IPrintServerInfoParams {
  version?: string;
  server?: Server;
  /** The Vite of the server printed, by default the one the config holds. */
  vite?: ViteDevServer;
}

/**
 * Print server info, failing when the logger, the URL lookup or Vite fails
 */
async function printInfo(
  config: ServerConfig,
  { server, version = 'unknown', vite = config.getVite() }: IPrintServerInfoParams = {},
): Promise<void> {
  const { action } = config.getPluginConfig() ?? {};
  const { isProd, host, root, isSPA, base } = config.getParams();
  const devMarker = getMarkerFile(root);

  const Logger = config.getLogger();
  const perfStart = global.viteBoostStartTime ?? performance.now();
  const startupDurationString = chalk.dim(
    `ready in ${chalk.reset(chalk.bold(Math.ceil(performance.now() - perfStart)))} ms`,
  );

  Logger.info(
    `\n  ${chalk.green(
      `${chalk.bold(cliName.toUpperCase())} v${version}`,
    )}  ${startupDurationString}\n`,
    { clear: !Logger.hasWarned },
  );

  const viteConfig: (ResolvedConfig & { rawBase?: string }) | undefined = vite?.config;
  const isProdBuild = !viteConfig?.mode && !fs.existsSync(devMarker);
  const resolvedUrls = server
    ? await resolveServerUrls(server, {
        host,
        isHttps: Boolean(viteConfig?.server.https),
        rawBase: viteConfig?.rawBase ?? new URL(base ?? '/', 'http://localhost').pathname,
      })
    : null;
  const mode =
    viteConfig?.mode || isProdBuild
      ? config.mode
      : `production ${chalk.red('NODE_ENV=development')}`;
  const type = isSPA ? 'SPA' : 'SSR';

  Logger.info(chalk.dim(chalk.green('  ➜')) + chalk.dim('  Mode:    ') + chalk.blue(mode));
  Logger.info(chalk.dim(chalk.green('  ➜')) + chalk.dim('  Type:    ') + chalk.blue(type));

  if (!isProd) {
    vite!.resolvedUrls = resolvedUrls;
    vite!.printUrls();
  } else if (resolvedUrls) {
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

/**
 * Report a failed banner without throwing: the server is already listening and must keep running.
 */
function reportPrintFailure(config: ServerConfig, error: unknown): void {
  const message = `failed to print server info: ${describeError(error)}`;

  logSafely(
    () => config.getLogger(),
    (logger) => logger.error(chalk.red(message)),
    message,
  );
}

/**
 * Print server info. It never rejects, so a caller may start it without awaiting: a failure is
 * logged and the started server keeps running.
 */
async function printServerInfo(
  config: ServerConfig,
  params: IPrintServerInfoParams = {},
): Promise<void> {
  try {
    await printInfo(config, params);
  } catch (error) {
    reportPrintFailure(config, error);
  }
}

export default printServerInfo;
