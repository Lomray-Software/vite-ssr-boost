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

// Client files the build emitted with a content hash, relative to the client directory.
const FINGERPRINTED_FILES = 'server/fingerprinted-files.json';

/**
 * Pick the build directory. The CLI keeps the 8.6 lookup: the first present of the given one,
 * ./build and ./dist. A strict lookup uses an explicit directory alone and requires it to exist.
 */
const findBuildDir = (buildDir?: string, isStrict = false): string | undefined => {
  if (buildDir === undefined || !isStrict) {
    return [buildDir, ...DEFAULT_BUILD_DIRS].find(
      (candidate) => candidate && fs.existsSync(candidate),
    );
  }

  if (!fs.existsSync(buildDir)) {
    throw new Error(`Build directory not found: ${path.resolve(buildDir)}. Run ssr-boost build.`);
  }

  return buildDir;
};

/**
 * Read relocatable build settings while retaining conventional paths for older builds.
 */
const loadProductionConfig = (
  buildDir?: string,
  isStrict = false,
): IProductionConfig | undefined => {
  const directory = findBuildDir(buildDir, isStrict);

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

/**
 * Read the hashed client files a build recorded; undefined when the build left no list.
 */
const loadFingerprintedFiles = (root: string): string[] | undefined => {
  const filename = path.join(root, FINGERPRINTED_FILES);
  let contents: string;

  try {
    contents = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const files = JSON.parse(contents) as unknown;

  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) {
    throw new Error(`Invalid fingerprinted files list: ${filename}. Run ssr-boost build again.`);
  }

  return files as string[];
};

export { DEFAULT_BUILD_DIRS, FINGERPRINTED_FILES, findBuildDir, loadFingerprintedFiles };

export type { IProductionConfig, TManagedServer };

export default loadProductionConfig;
