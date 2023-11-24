import fs from 'node:fs';
import type { Server } from 'node:net';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import type { ResolvedConfig } from 'vite';
import CliActions from '@constants/cli-actions';
import cliName from '@constants/cli-name';
import { getMarkerFile } from '@helpers/dev-marker';
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
  const { isProd, host, root } = config.getParams();
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

  const viteConfig = config.getVite()?.config as
    | (ResolvedConfig & { rawBase?: string })
    | undefined;
  const isProdBuild = !viteConfig?.mode && !fs.existsSync(devMarker);
  const resolvedUrls = await resolveServerUrls(server, {
    host,
    isHttps: typeof viteConfig?.server.https === 'boolean' ? viteConfig?.server.https : false,
    rawBase: viteConfig?.rawBase,
  });
  const mode =
    viteConfig?.mode || isProdBuild
      ? config.mode
      : `production ${chalk.red('NODE_ENV=development')}`;

  Logger.info(chalk.dim(chalk.green('  ➜')) + chalk.dim('  Mode:    ') + chalk.blue(mode));

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
