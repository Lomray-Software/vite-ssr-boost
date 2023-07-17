import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import { resolveConfig } from 'vite';
import viteResetCache from '@cli/vite-reset-cache';
import cliName from '@constants/cli-name';
import { createDevMarker } from '@helpers/dev-marker';
import getPluginConfig from '@helpers/plugin-config';
import unlockRobots from '@helpers/unlock-robots';
import SsrManifest from '@services/ssr-manifest';

interface IBuildParams {
  isOnlyClient?: boolean;
  isWatch?: boolean;
  isUnlockRobots?: boolean;
  clientOptions?: string;
  serverOptions?: string;
  mode?: string;
  onFinish?: () => void;
}

/**
 * Promisify spawn process
 */
const promisify = (command: childProcess.ChildProcess) => {
  const promise = new Promise((resolve, reject) => {
    command.on('exit', (code) => {
      resolve(code);
    });

    command.on('close', (code) => {
      resolve(code);
    });

    command.on('error', (message) => {
      reject(message);
    });
  });

  command.stdout?.pipe(process.stdout);
  command.stderr?.pipe(process.stderr);

  promise['command'] = command;

  return promise;
};

/**
 * Build production application
 */
async function build({
  onFinish,
  isOnlyClient = false,
  isWatch = false,
  isUnlockRobots = false,
  clientOptions = '',
  serverOptions = '',
  mode = '',
}: IBuildParams): Promise<void> {
  const perfStart = performance.now();
  const config = await resolveConfig(
    {},
    'build',
    mode,
    mode === 'production' ? 'production' : 'development',
  );
  const pluginConfig = getPluginConfig(config);
  const { outDir } = config.build;
  const types = ['client'];
  const controller = new AbortController();
  const modeOpt = mode ? `--mode ${mode}` : '';
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const buildDir = path.resolve(config.root, outDir);

  // this is required step - build with different env may cause problems
  await viteResetCache();

  // clear build folder
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true });
  }

  /**
   * Build client
   */
  const clientProcess = promisify(
    childProcess.spawn(
      `vite build ${clientOptions} --emptyOutDir --outDir ${outDir}/client ${modeOpt}`,
      {
        signal: controller.signal,
        stdio: [process.stdin, 'pipe', process.stderr],
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: '2',
          SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
          SSR_BOOST_ACTION: global.viteBoostAction,
        },
      },
    ),
  );

  if (!isWatch) {
    await clientProcess;
  }

  let serverProcess: Promise<unknown> | undefined;

  /**
   * Build server
   */
  if (!isOnlyClient) {
    serverProcess = promisify(
      childProcess.spawn(
        `vite build ${serverOptions} --emptyOutDir --outDir ${outDir}/server --ssr ${pluginConfig.serverFile} ${modeOpt}`,
        {
          signal: controller.signal,
          stdio: [process.stdin, 'pipe', process.stderr],
          shell: true,
          env: {
            ...process.env,
            FORCE_COLOR: '2',
            SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
            SSR_BOOST_ACTION: global.viteBoostAction,
          },
        },
      ),
    );

    if (!isWatch) {
      await serverProcess;
      await SsrManifest.get(config.root, {
        alias: config.resolve.alias,
        buildDir: outDir,
      }).buildRoutesManifest(pluginConfig.preloadAssets);
    }

    types.push('server');
  }

  /**
   * Preview mode
   */
  if (isWatch) {
    process.on('exit', () => {
      controller.abort();
    });

    let buildCount = isOnlyClient ? 1 : 2;
    const listener = (buff: Uint8Array): void => {
      const msg = Buffer.from(buff).toString();

      if (msg.includes('built in')) {
        buildCount -= 1;

        if (!buildCount) {
          clientProcess['command'].stdout.removeListener('data', listener);
          serverProcess?.['command'].stdout.removeListener('data', listener);
          createDevMarker(isProd, config);
          onFinish?.();
        }
      }
    };

    /**
     * Listen output for call onFinish
     */
    clientProcess['command'].stdout.on('data', listener);
    serverProcess?.['command'].stdout.on('data', listener);

    return;
  }

  if (isUnlockRobots) {
    unlockRobots(config.root, outDir);
  }

  createDevMarker(isProd, config);
  onFinish?.();

  const buildDurationString = chalk.dim(
    `${chalk.yellowBright(types.join(','))} built in ${chalk.reset(
      chalk.bold(Math.ceil(performance.now() - perfStart)),
    )} ms`,
  );

  console.info(
    `\n  ${chalk.green(`${chalk.bold(cliName.toUpperCase())}`)}  ${buildDurationString} ${
      isProd ? '' : chalk.redBright(`NODE_ENV=${nodeEnv}`)
    }\n`,
  );
}

export default build;
