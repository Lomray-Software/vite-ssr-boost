import childProcess from 'node:child_process';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import viteResetCache from '@cli/helpers/vite-reset-cache';
import cliName from '@constants/cli-name';
import { createDevMarker } from '@helpers/dev-marker';
import processStop from '@helpers/process-stop';
import Build from '@services/build';

interface IBuildParams {
  onFinish?: () => void;
  mode?: string;
  clientOptions?: string;
  serverOptions?: string;
  isOnlyClient?: boolean;
  isWatch?: boolean;
  isUnlockRobots?: boolean;
  isEject?: boolean;
  isNoWarnings?: boolean;
}

/**
 * Build production application
 */
async function build({
  onFinish,
  mode = '',
  clientOptions = '',
  serverOptions = '',
  isOnlyClient = false,
  isWatch = false,
  isUnlockRobots = false,
  isEject = false,
  isNoWarnings = false,
}: IBuildParams): Promise<void> {
  const perfStart = performance.now();
  const buildService = new Build({ mode });
  const types = ['client'];
  const controller = new AbortController();
  const modeOpt = mode ? `--mode ${mode}` : '';

  await buildService.makeConfig();

  // this is required step - build with different env may cause problems
  await viteResetCache();
  buildService.clearBuildFolder();

  /**
   * Build client
   */
  const clientProcess = buildService.promisifyProcess(
    childProcess.spawn(
      `vite build ${clientOptions} --emptyOutDir --outDir ${buildService.outDir}/client ${modeOpt}`,
      {
        signal: controller.signal,
        stdio: [process.stdin, 'pipe', 'pipe'],
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: '2',
          SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
          SSR_BOOST_ACTION: global.viteBoostAction,
        },
      },
    ),
    isNoWarnings,
  );

  if (!isWatch) {
    const exitCode = await clientProcess.promise;

    processStop(exitCode, true);
  }

  let serverProcess: ReturnType<Build['promisifyProcess']> | null = null;

  /**
   * Build server
   */
  if (!isOnlyClient) {
    serverProcess = buildService.promisifyProcess(
      childProcess.spawn(
        `vite build ${serverOptions} --emptyOutDir --outDir ${buildService.outDir}/server --ssr ${buildService.serverFile} ${modeOpt}`,
        {
          signal: controller.signal,
          stdio: [process.stdin, 'pipe', 'pipe'],
          shell: true,
          env: {
            ...process.env,
            FORCE_COLOR: '2',
            SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
            SSR_BOOST_ACTION: global.viteBoostAction,
          },
        },
      ),
      isNoWarnings,
    );

    if (!isWatch) {
      const exitCode = await serverProcess.promise;

      processStop(exitCode, true);
      await buildService.buildManifest();

      if (isEject) {
        buildService.eject();
      }
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
          clientProcess.command.stdout?.removeListener('data', listener);
          serverProcess?.command.stdout?.removeListener('data', listener);
          createDevMarker(buildService.isProd, buildService.viteConfig);
          onFinish?.();
        }
      }
    };

    /**
     * Listen output for call onFinish
     */
    clientProcess.command.stdout?.on('data', listener);
    serverProcess?.command.stdout?.on('data', listener);

    return;
  }

  if (isUnlockRobots) {
    buildService.unlockRobots();
  }

  createDevMarker(buildService.isProd, buildService.viteConfig);
  onFinish?.();

  const durationMs = Math.ceil(performance.now() - perfStart);
  const duration = durationMs > 1000 ? (durationMs / 1000).toFixed(2) : durationMs;
  const units = durationMs > 1000 ? 's' : 'ms';

  const buildDurationString = chalk.dim(
    `${chalk.yellowBright(types.join(','))} built in ${chalk.reset(chalk.bold(duration))} ${units}`,
  );

  console.info(
    `\n  ${chalk.green(`${chalk.bold(cliName.toUpperCase())}`)}  ${buildDurationString} ${
      buildService.isProd ? '' : chalk.redBright(`NODE_ENV=${buildService.nodeEnv}`)
    }\n`,
  );
}

export default build;
