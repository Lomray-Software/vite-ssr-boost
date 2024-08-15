import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import cliName from '@constants/cli-name';
import type { IBuildParams } from '@services/build';
import Build from '@services/build';

/**
 * Build application
 */
async function build(params: IBuildParams): Promise<void> {
  const perfStart = performance.now();
  const buildService = new Build(params);

  await buildService.build();

  const durationMs = Math.ceil(performance.now() - perfStart);
  const duration = durationMs > 1000 ? (durationMs / 1000).toFixed(2) : durationMs;
  const units = durationMs > 1000 ? 's' : 'ms';

  const buildDurationString = chalk.dim(
    `${chalk.yellowBright(buildService.getRunningBuildNames().join(','))} built in ${chalk.reset(chalk.bold(duration))} ${units}`,
  );

  console.info(
    `\n  ${chalk.green(`${chalk.bold(cliName.toUpperCase())}`)}  ${buildDurationString} ${
      buildService.getIsProd() ? '' : chalk.redBright(`NODE_ENV=${buildService.getNodeEnv()}`)
    }\n`,
  );
}

export default build;
