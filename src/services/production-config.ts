import fs from 'node:fs';
import path from 'node:path';

interface IProductionConfig {
  version: 1;
  root: string;
  base: string;
  mode: string;
  publicDir: string;
  indexFile: string;
  serverFile: string;
  // Missing means express: builds made before the managed node server existed.
  managedServer?: TManagedServer;
}

type TManagedServer = 'node' | 'express';

const managedServers: ReadonlySet<unknown> = new Set(['node', 'express']);

const DEFAULT_BUILD_DIRS = ['./build', './dist'];

/**
 * Pick the build directory: an explicit one alone, otherwise the first conventional one present.
 */
const findBuildDir = (buildDir?: string): string | undefined => {
  if (buildDir === undefined) {
    return DEFAULT_BUILD_DIRS.find((candidate) => fs.existsSync(candidate));
  }

  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found: ${path.resolve(buildDir)}. Run ssr-boost build.`);
  }

  return buildDir;
};

/**
 * Read relocatable build settings while retaining conventional paths for older builds.
 */
const loadProductionConfig = (buildDir?: string): IProductionConfig | undefined => {
  const directory = findBuildDir(buildDir);

  if (!directory) {
    return;
  }

  const filename = path.resolve(directory, 'server/ssr-boost.json');
  let contents: string;

  try {
    contents = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const config = JSON.parse(contents) as IProductionConfig;

  if (
    config?.version !== 1 ||
    ['root', 'base', 'mode', 'publicDir', 'indexFile', 'serverFile'].some(
      (key) => typeof config[key as keyof IProductionConfig] !== 'string',
    ) ||
    (config.managedServer !== undefined && !managedServers.has(config.managedServer))
  ) {
    throw new Error(`Invalid production configuration: ${filename}. Run ssr-boost build again.`);
  }

  return { ...config, root: path.resolve(path.dirname(filename), config.root) };
};

export { DEFAULT_BUILD_DIRS, findBuildDir };

export type { IProductionConfig, TManagedServer };

export default loadProductionConfig;
