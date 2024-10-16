#!/usr/bin/env node

import { readFileSync } from 'fs';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import runBuild from '@cli/build';
import onKeyPress from '@cli/helpers/keyboard-input';
import viteResetCache from '@cli/helpers/vite-reset-cache';
import type {
  IBuildActionParams,
  IBuildAmplifyActionParams,
  IBuildDockerActionParams,
  IBuildVercelActionParams,
  IDevActionParams,
  IPreviewActionParams,
  IStartActionParams,
} from '@cli/interfaces/actions';
import runAmplifyBuild from '@cli/run-amplify-build';
import runDev from '@cli/run-dev';
import runDockerBuild from '@cli/run-docker-build';
import runProd from '@cli/run-prod';
import runVercelBuild from '@cli/run-vercel-build';
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
const focusOnlyOption = new Option(
  '--focus-only [focusOnly]',
  'Build or Start only specified part of app.',
)
  .default('app')
  .choices(['all', 'app', 'client', 'server', 'entrypoint']);
const portOption = new Option('--port [port]', 'Server port.').default(3000);
const envModeOption = new Option('--mode [mode]', 'Env mode.')
  .env('VITE_ENV_MODE')
  .default('production');
const buildDirOption = new Option('--build-dir [buildDir]', 'Build directory output.');

/**
 * Cli commands
 */

program
  .command(CliActions.dev)
  .description('Run development server.')
  .addOption(hostOption)
  .addOption(portOption)
  .addOption(new Option('--reset-cache', 'Clear vite cache before run.').default(false))
  .addOption(new Option('--mode [mode]', 'Env mode.').env('VITE_ENV_MODE').default('development'))
  .addOption(new Option('--entrypoint [entrypoint]', 'Run only entrypoint by name.'))
  .action(async ({ host, port, resetCache, mode, entrypoint }: IDevActionParams) => {
    if (resetCache) {
      await viteResetCache();
    }

    const command = async (isPrintInfo?: boolean): Promise<void> => {
      console.info(chalk.cyan('Starting the development server...'));

      const { server, config } = await runDev({
        version,
        isHost: host,
        isPrintInfo,
        port,
        mode,
        entrypointName: entrypoint,
      });

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
  .addOption(focusOnlyOption)
  .addOption(envModeOption)
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
  .addOption(
    new Option(
      '--unlock-robots',
      'Change general directive Disallow to Allow in robots.txt',
    ).default(false),
  )
  .addOption(
    new Option('--eject', 'Produces entrypoint file to run app without cli').default(false),
  )
  .addOption(
    new Option(
      '--serverless',
      'Produces entrypoint file to run app like serverless function',
    ).default(false),
  )
  .addOption(
    new Option(
      '--throw-warnings',
      'The build will abort with an error if warnings occur in the process.',
    ).default(false),
  )
  .action(
    async ({
      focusOnly,
      clientOptions,
      serverOptions,
      mode,
      unlockRobots,
      eject,
      serverless,
      throwWarnings,
    }: IBuildActionParams) => {
      await runBuild({
        focusOnly,
        isUnlockRobots: unlockRobots,
        isNoWarnings: throwWarnings,
        isEject: eject,
        isServerless: serverless,
        clientOptions,
        serverOptions,
        mode: mode!,
      });
    },
  );

program
  .command(CliActions.start)
  .description('Run production server.')
  .addOption(hostOption)
  .addOption(portOption)
  .addOption(focusOnlyOption)
  .addOption(buildDirOption)
  .addOption(
    new Option('--module-preload', 'Add module preload scripts to server output.').default(false),
  )
  .action(({ host, port, focusOnly, modulePreload, buildDir }: IStartActionParams) => {
    const command = async (isPrintInfo?: boolean): Promise<void> => {
      const { server, config } = await runProd({
        version,
        isHost: host,
        isPrintInfo,
        port,
        focusOnly,
        modulePreload,
        buildDir,
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
  .addOption(focusOnlyOption)
  .addOption(hostOption)
  .addOption(portOption)
  .addOption(envModeOption)
  .addOption(buildDirOption)
  .action(async ({ host, port, focusOnly, mode, buildDir }: IPreviewActionParams) => {
    global.viteBoostStartTime = performance.now();

    const command = async (isPrintInfo?: boolean): Promise<void> => {
      const { server, config } = await runProd({
        version,
        isHost: host,
        isPrintInfo,
        port,
        focusOnly,
        buildDir,
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

    await runBuild({
      mode: mode!,
      isWatch: true,
      focusOnly,
      clientOptions: buildOptions,
      serverOptions: buildOptions,
      onFinish: () => {
        void command();
      },
    });
  });

program
  .command(CliActions.buildDocker)
  .description('Create docker image with production build.')
  .requiredOption('--image-name <image-name>', 'Docker image name.')
  .addOption(
    new Option(
      '--docker-options [docker-options]',
      'Extra docker options which pass to docker build command.',
    ),
  )
  .addOption(
    new Option(
      '--docker-file [docker-file]',
      'Name of the Dockerfile (Default is PLUGIN_PATH/workflow/Dockerfile).',
    ),
  )
  .addOption(focusOnlyOption)
  .addOption(envModeOption)
  .action(
    async ({ imageName, dockerOptions, dockerFile, focusOnly, mode }: IBuildDockerActionParams) => {
      await runDockerBuild({
        imageName,
        dockerOptions,
        dockerFile,
        focusOnly,
        mode,
      });
    },
  );

program
  .command(CliActions.buildAmplify)
  .description('Create AWS Amplify production build.')
  .addOption(
    new Option(
      '--manifest-file [manifest-file]',
      'Path to the Amplify manifest file (Default is PLUGIN_PATH/workflow/amplify-manifest.json).',
    ),
  )
  .addOption(new Option('--is-optimize', 'Optimize node_modules folder.').default(false))
  .addOption(envModeOption)
  .action(async ({ manifestFile, mode, isOptimize }: IBuildAmplifyActionParams) => {
    await runAmplifyBuild({
      manifestFile,
      mode,
      isOptimize,
    });
  });

program
  .command(CliActions.buildVercel)
  .description('Create Vercel serverless production build.')
  .addOption(
    new Option(
      '--config-file [config-file]',
      'Path to the Vercel config.json file (Default is PLUGIN_PATH/workflow/vercel.config.json).',
    ),
  )
  .addOption(
    new Option(
      '--config-vc-file [config-vc-file]',
      'Path to the Vercel vc-config.json file (Default is PLUGIN_PATH/workflow/vercel.vc-config.json).',
    ),
  )
  .addOption(new Option('--is-optimize', 'Optimize node_modules folder.').default(false))
  .addOption(envModeOption)
  .action(async ({ configFile, configVcFile, mode, isOptimize }: IBuildVercelActionParams) => {
    await runVercelBuild({
      configFile,
      configVcFile,
      mode,
      isOptimize,
    });
  });

program.parse();
