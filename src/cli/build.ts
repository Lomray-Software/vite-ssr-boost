import childProcess from 'node:child_process';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import { resolveConfig } from 'vite';
import cliName from '@constants/cli-name';
import getPluginConfig from '@helpers/plugin-config';

interface IBuildParams {
  isOnlyClient?: boolean;
  isWatch?: boolean;
  clientOptions?: string;
  serverOptions?: string;
  mode?: string;
}

/**
 * Promisify spawn process
 */
const promisify = (command: childProcess.ChildProcess) =>
  new Promise((resolve, reject) => {
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

/**
 * Build production application
 */
async function build({
  isOnlyClient = false,
  isWatch = false,
  clientOptions = '',
  serverOptions = '',
  mode = '',
}: IBuildParams): Promise<void | [unknown, unknown]> {
  const perfStart = performance.now();
  const config = await resolveConfig({}, 'build');
  const pluginConfig = getPluginConfig(config);
  const { outDir } = config.build;
  const types = ['client'];
  const controller = new AbortController();
  const modeOpt = mode ? `--mode ${mode}` : '';

  // build client
  const clientProcess = promisify(
    childProcess.spawn(
      `vite build ${clientOptions} --emptyOutDir --outDir ${outDir}/client ${modeOpt}`,
      {
        signal: controller.signal,
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
        },
      },
    ),
  );

  if (!isWatch) {
    await clientProcess;
  }

  let serverProcess;

  if (!isOnlyClient) {
    // build server
    serverProcess = promisify(
      childProcess.spawn(
        `vite build ${serverOptions} --emptyOutDir --outDir ${outDir}/server --ssr ${pluginConfig.serverFile} ${modeOpt}`,
        {
          signal: controller.signal,
          stdio: 'inherit',
          shell: true,
          env: {
            ...process.env,
            SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
          },
        },
      ),
    );

    if (!isWatch) {
      await serverProcess;
    }

    types.push('server');
  }

  if (isWatch) {
    process.on('exit', () => {
      controller.abort();
    });

    const buildPromise = Promise.all([clientProcess, serverProcess]);

    buildPromise['controller'] = controller;

    return buildPromise;
  }

  const buildDurationString = chalk.dim(
    `${chalk.yellowBright(types.join(','))} built in ${chalk.reset(
      chalk.bold(Math.ceil(performance.now() - perfStart)),
    )} ms`,
  );

  console.info(
    `\n  ${chalk.green(`${chalk.bold(cliName.toUpperCase())}`)}  ${buildDurationString}\n`,
  );
}

export default build;
