#!/usr/bin/env node

import { readFileSync } from 'fs';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import runBuild from '@cli/build';
import onKeyPress from '@cli/keyboard-input';
import runDev from '@cli/run-dev';
import runProd from '@cli/run-prod';
import viteResetCache from '@cli/vite-reset-cache';
import CliActions from '@constants/cli-actions';
import cliContext from '@constants/cli-context';
import cliName from '@constants/cli-name';

/**
 * Parse package meta
 */
const { description, version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { name: string; description: string; version: string };

/**
 * Enable shortcuts
 * listen keyboard command
 */
const enableShortcuts = (): void => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on('data', onKeyPress).setEncoding('utf8').resume();
  }
};

const program = new Command();

program
  .name(cliName)
  .description(description)
  .version(version)
  .hook('preAction', (_, actionCommand) => {
    // pass cli action to plugin config
    global.viteBoostAction = actionCommand.name();
  });

/**
 * Common options
 */
const hostOption = new Option(
  '--host',
  'Ability to access the local instance on other devices under the same network.',
).default(false);
const onlyClientOption = new Option('--only-client', 'Build/run only client side part.').default(
  false,
);
const portOption = new Option('--port [port]', 'Server port.').default(3000);

/**
 * Cli commands
 */

program
  .command(CliActions.dev)
  .description('Run development server.')
  .addOption(hostOption)
  .addOption(new Option('--reset-cache', 'Clear vite cache before run.').default(false))
  .action(async ({ host, resetCache }) => {
    if (resetCache) {
      await viteResetCache();
    }

    const command = async (isPrintInfo?: boolean): Promise<void> => {
      const { server, config } = await runDev({ version, isHost: host, isPrintInfo });

      cliContext.server = server;
      cliContext.config = config;
    };

    cliContext.reboot = command;

    enableShortcuts();

    return command();
  });

program
  .command(CliActions.build)
  .description('Create production build.')
  .addOption(onlyClientOption)
  .addOption(
    new Option(
      '--client-options [client-options]',
      'Pass vite build options for client. Example: --client-options="--ssrManifest"',
    )
      .env('VITE_BUILD_CLIENT_OPTIONS')
      .default(''),
  )
  .addOption(
    new Option('--server-options [server-options]', 'Pass vite build options for server.')
      .env('VITE_BUILD_SERVER_OPTIONS')
      .default(''),
  )
  .action(async ({ onlyClient, clientOptions, serverOptions }) => {
    await runBuild({ isOnlyClient: onlyClient, clientOptions, serverOptions });
  });

program
  .command(CliActions.start)
  .description('Run production server.')
  .addOption(hostOption)
  .addOption(portOption)
  .addOption(onlyClientOption)
  .action(({ host, port, onlyClient }) => {
    const command = async (isPrintInfo?: boolean): Promise<void> => {
      const { server, config } = await runProd({
        version,
        isHost: host,
        isPrintInfo,
        port,
        onlyClient,
      });

      cliContext.server = server;
      cliContext.config = config;
    };

    cliContext.reboot = command;

    enableShortcuts();

    return command();
  });

program
  .command(CliActions.preview)
  .description('Build and preview production.')
  .addOption(onlyClientOption)
  .addOption(hostOption)
  .addOption(portOption)
  .action(async ({ host, port, onlyClient }) => {
    const command = async (isPrintInfo?: boolean): Promise<void> => {
      const { server, config } = await runProd({
        version,
        isHost: host,
        isPrintInfo,
        port,
        onlyClient,
      });

      server.on('listening', () => {
        setTimeout(() => {
          config.getLogger().info(chalk.yellow('\n  Running preview mode... \n'));
        }, 0);
      });

      cliContext.server = server;
      cliContext.config = config;
    };

    cliContext.reboot = command;

    enableShortcuts();

    const buildOptions = '-w';
    const build = runBuild({
      isWatch: true,
      isOnlyClient: onlyClient,
      clientOptions: buildOptions,
      serverOptions: buildOptions,
    });

    await Promise.all([command(), build]);
  });

program.parse();
