import type { ExecSyncOptions } from 'child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import chalk from 'chalk';
import { resolveConfig } from 'vite';
import getPluginConfig from '@helpers/plugin-config';

interface IRunVercelBuildParams {
  configFile?: string;
  configVcFile?: string;
  mode?: string;
  isOptimize?: boolean;
}

/**
 * Create Vercel SSR build
 */
async function runVercelBuild({
  configFile,
  configVcFile,
  mode = '',
  isOptimize = false,
}: IRunVercelBuildParams): Promise<void> {
  const config = await resolveConfig({}, 'build', mode);
  const pluginConfig = getPluginConfig(config);
  const {
    root,
    build: { outDir },
  } = config;
  const projectRoot = cwd();
  const buildDir = `.${path.resolve(root, outDir).replace(projectRoot, '')}`; // relative path
  const manFile = configFile || `${pluginConfig.pluginPath}/workflow/vercel.config.json`;
  const manVcFile = configVcFile || `${pluginConfig.pluginPath}/workflow/vercel.vc-config.json`;
  const outputDir = `${projectRoot}/.vercel/output`;
  const stdOpts: ExecSyncOptions = {
    stdio: 'inherit',
  };

  // Check build serverless
  if (!fs.existsSync(`${buildDir}/server/serverless.js`)) {
    console.error(
      chalk.red(
        'Failed create Vercel build: Before, you should create standard build with `serverless` option.',
      ),
    );

    return;
  }

  if (fs.existsSync(outputDir)) {
    childProcess.execSync(`rm -rf ${outputDir}`, stdOpts);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(`${outputDir}/functions/index.func`, { recursive: true });
  childProcess.execSync(`cp ${manFile} ${outputDir}/config.json`, stdOpts);
  childProcess.execSync(
    `cp ${manVcFile} ${outputDir}/functions/index.func/.vc-config.json`,
    stdOpts,
  );
  childProcess.execSync(
    `cp ${buildDir}/server/serverless.js ${outputDir}/functions/index.func/index.js`,
    stdOpts,
  );
  childProcess.execSync(
    `cp -r ${projectRoot}/node_modules ${outputDir}/functions/index.func/node_modules`,
    stdOpts,
  );
  childProcess.execSync(`cp -r ${buildDir} ${outputDir}/functions/index.func/build`, stdOpts);
  childProcess.execSync(
    `cp -r ${projectRoot}/package.json ${outputDir}/functions/index.func/package.json`,
    stdOpts,
  );
  childProcess.execSync(
    `cp -r ${projectRoot}/package-lock.json ${outputDir}/functions/index.func/package-lock.json`,
    stdOpts,
  );
  childProcess.execSync(`cp -r ${buildDir}/client ${outputDir}/static`, stdOpts);

  if (isOptimize) {
    childProcess.execSync(`cd ${outputDir}/functions/index.func && npm ci --omit=dev`, stdOpts);
  }

  console.info(`\n${chalk.cyan('Vercel build success created.')}`);
}

export default runVercelBuild;
