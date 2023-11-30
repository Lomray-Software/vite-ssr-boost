import type { ExecSyncOptions } from 'child_process';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import chalk from 'chalk';
import { resolveConfig } from 'vite';
import getPluginConfig from '@helpers/plugin-config';

interface IRunAmplifyBuildParams {
  manifestFile?: string;
  mode?: string;
  isOptimize?: boolean;
}

/**
 * Create AWS Amplify SSR build
 */
async function runAmplifyBuild({
  manifestFile,
  mode = '',
  isOptimize = false,
}: IRunAmplifyBuildParams): Promise<void> {
  const config = await resolveConfig({}, 'build', mode);
  const pluginConfig = getPluginConfig(config);
  const {
    root,
    build: { outDir },
  } = config;
  const projectRoot = cwd();
  const buildDir = `.${path.resolve(root, outDir).replace(projectRoot, '')}`; // relative path
  const manFile = manifestFile || `${pluginConfig.pluginPath}/workflow/amplify-manifest.json`;
  const amplifyDir = `${projectRoot}/.amplify-hosting`;
  const computeDir = `${amplifyDir}/compute/default`;
  const stdOpts: ExecSyncOptions = {
    stdio: 'inherit',
  };

  // Check build server
  if (!fs.existsSync(`${buildDir}/server/start.js`)) {
    console.error(
      chalk.red(
        'Failed create Amplify build: Before, you should create standard build with `eject` option.',
      ),
    );

    return;
  }

  if (fs.existsSync(amplifyDir)) {
    childProcess.execSync(`rm -rf ${amplifyDir}`, stdOpts);
  }

  fs.mkdirSync(computeDir, { recursive: true });
  childProcess.execSync(`cp -r ${buildDir} ${computeDir}/build`, stdOpts);
  childProcess.execSync(`cp ${projectRoot}/package.json ${computeDir}/package.json`, stdOpts);
  childProcess.execSync(
    `cp ${projectRoot}/package-lock.json ${computeDir}/package-lock.json`,
    stdOpts,
  );
  childProcess.execSync(`cp -r ${buildDir}/client ${amplifyDir}/static`, stdOpts);
  childProcess.execSync(`cp ${manFile} ${amplifyDir}/deploy-manifest.json`, stdOpts);
  childProcess.execSync(`cp -r ${projectRoot}/node_modules ${computeDir}/node_modules`);

  if (isOptimize) {
    childProcess.execSync(`cd ${computeDir} && npm ci --omit=dev`, stdOpts);
  }

  // cleanup
  childProcess.execSync(`rm -rf ${computeDir}/build/client/assets`, stdOpts);

  console.info(`\n${chalk.cyan('AWS Amplify build success created.')}`);
}

export default runAmplifyBuild;
