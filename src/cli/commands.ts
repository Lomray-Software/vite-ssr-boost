import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import type { IDoctorOptions } from '@cli/doctor';
import enableShortcuts from '@cli/helpers/enable-shortcuts';
import type { IInitOptions } from '@cli/init';
import type {
  IBuildActionParams,
  IBuildAmplifyActionParams,
  IBuildDockerActionParams,
  IBuildVercelActionParams,
  IDevActionParams,
  IPreviewActionParams,
} from '@cli/interfaces/actions';
import { runStart } from '@cli/start';
import CliActions from '@constants/cli-actions';
import cliContext from '@constants/cli-context';
import cliName from '@constants/cli-name';

/**
 * Parse package meta
 */
const { description, version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; description: string; version: string };

const program = new Command();

program
  .name(cliName)
  .description(description)
  .version(version)

  /** Record the selected action for build and development plugins. */
  .hook('preAction', (_, actionCommand) => {
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

  /** Load development services only when the development command runs. */
  .action(async ({ host, port, resetCache, mode, entrypoint }: IDevActionParams) => {
    if (resetCache) {
      const { default: viteResetCache } = await import('@cli/helpers/vite-reset-cache');

      await viteResetCache();
    }

    /** Restart the selected managed server with its original CLI options. */
    const command = async (isPrintInfo?: boolean): Promise<void> => {
      console.info(chalk.cyan('Starting the development server...'));

      const { default: runDev } = await import('@cli/run-dev');
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

    await enableShortcuts();

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

  /** Load the requested build implementation on demand. */
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
      await (
        await import('@cli/build')
      ).default({
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
  .action(runStart);

program
  .command(CliActions.preview)
  .description('Build and preview production.')
  .addOption(focusOnlyOption)
  .addOption(hostOption)
  .addOption(portOption)
  .addOption(envModeOption)
  .addOption(buildDirOption)

  /** Start the managed production server after each preview build completes. */
  .action(async ({ host, port, focusOnly, mode, buildDir }: IPreviewActionParams) => {
    global.viteBoostStartTime = performance.now();

    /** Restart the selected managed server with its original CLI options. */
    const command = async (isPrintInfo?: boolean): Promise<void> => {
      const { default: runProd } = await import('@cli/run-prod');
      const { server, config } = await runProd({
        version,
        isHost: host,
        isPrintInfo,
        port,
        focusOnly,
        buildDir,
      });

      /** Announce preview mode after the managed listener is ready. */
      server.on('listening', () => {
        /** Keep the preview message after the normal readiness output. */
        setTimeout(() => {
          config.getLogger().info(chalk.yellow('\n  Running preview mode... \n'));
        }, 0);
      });

      cliContext.server = server;
      cliContext.config = config;
    };

    cliContext.reboot = command;

    await enableShortcuts();

    const buildOptions = '-w';

    await (
      await import('@cli/build')
    ).default({
      mode: mode!,
      isWatch: true,
      focusOnly,
      clientOptions: buildOptions,
      serverOptions: buildOptions,

      /** Restart after the watched outputs are ready. */
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

  /** Load the requested build implementation on demand. */
  .action(
    async ({ imageName, dockerOptions, dockerFile, focusOnly, mode }: IBuildDockerActionParams) => {
      await (
        await import('@cli/run-docker-build')
      ).default({
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

  /** Load the Amplify builder on demand. */
  .action(async ({ manifestFile, mode, isOptimize }: IBuildAmplifyActionParams) => {
    await (
      await import('@cli/run-amplify-build')
    ).default({
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

  /** Load the Vercel builder on demand. */
  .action(async ({ configFile, configVcFile, mode, isOptimize }: IBuildVercelActionParams) => {
    await (
      await import('@cli/run-vercel-build')
    ).default({
      configFile,
      configVcFile,
      mode,
      isOptimize,
    });
  });

program
  .command('doctor')
  .description('Inspect SSR setup and report actionable checks.')
  .option('--json', 'Print machine-readable JSON.')
  .option('--root <dir>', 'Project directory.')
  .option('--bundle <file>', 'Write an allowlisted support bundle JSON.')

  /** Load diagnostic tooling only for doctor. */
  .action(async (options: IDoctorOptions) => (await import('@cli/doctor')).default(options));

program
  .command('init')
  .description('Add SSR to an existing Vite + React Router app (dry run by default).')
  .option('--dry-run', 'Print every change without writing files.')
  .option('--apply', 'Write the proposed changes.')
  .option('--root <dir>', 'Project directory.')
  .option('--entry <file>', 'Browser entry relative to the project directory.')
  .option('--routes <file>', 'Module exporting the route array.')

  /** Load migration tooling only for init. */
  .action(async (options: IInitOptions) => (await import('@cli/init')).default(options));

await program.parseAsync();
