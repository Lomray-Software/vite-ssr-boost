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
  mode?: string;
  isOptimize?: boolean;
}

/**
 * Create Vercel SSR build
 */
async function runVercelBuild({
  configFile,
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
  const manFile = configFile || `${pluginConfig.pluginPath}/workflow/vercel.json`;
  const apiDir = `${projectRoot}/api`;
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

  if (fs.existsSync(apiDir)) {
    childProcess.execSync(`rm -rf ${apiDir}`, stdOpts);
  }

  fs.mkdirSync(apiDir, { recursive: true });

  const entrypoint = `${apiDir}/express.js`;
  const script =
    "import Express from '../build/server/serverless.js';\n\n" + `export default Express;\n`;

  fs.writeFileSync(entrypoint, script, {
    encoding: 'utf-8',
  });

  childProcess.execSync(`cp ${manFile} vercel.json`, stdOpts);

  if (isOptimize) {
    childProcess.execSync(`npm ci --omit=dev`, stdOpts);
  }

  console.info(`\n${chalk.cyan('Vercel build success created.')}`);
}

export default runVercelBuild;
