import childProcess from 'node:child_process';
import path from 'node:path';
import { cwd } from 'node:process';
import { resolveConfig } from 'vite';
import createFocusOnly from '@helpers/create-focus-only';
import getPluginConfig from '@helpers/plugin-config';
import type { IBuildParams } from '@services/build';

interface IRunDockerBuildParams {
  imageName: string;
  dockerOptions?: string;
  dockerFile?: string;
  focusOnly?: IBuildParams['focusOnly'];
  mode?: string;
}

/**
 * Build docker image
 */
async function runDockerBuild({
  imageName,
  dockerFile,
  focusOnly,
  dockerOptions = '',
  mode = '',
}: IRunDockerBuildParams): Promise<void> {
  const nodeEnv = mode === 'production' ? 'production' : 'development';
  const config = await resolveConfig({}, 'build', mode);
  const pluginConfig = getPluginConfig(config);
  const {
    root,
    build: { outDir },
  } = config;
  const projectRoot = cwd();
  const buildDir = `.${path.resolve(root, outDir).replace(projectRoot, '')}`; // relative path
  const runType = createFocusOnly(focusOnly).isOnlyClient() ? 'spa' : 'ssr';
  const docFile = dockerFile || `${pluginConfig.pluginPath}/workflow/Dockerfile`;

  childProcess.execSync(
    `docker build -f ${docFile}` +
      ` --build-arg BUILD_PATH=${buildDir}` +
      ` --build-arg RUN_TYPE=${runType} --build-arg ENV_MODE=${nodeEnv}` +
      ` ${dockerOptions} -t ${imageName} ${projectRoot}`,
    {
      stdio: 'inherit',
      env: {
        ...process.env,
      },
    },
  );
}

export default runDockerBuild;
