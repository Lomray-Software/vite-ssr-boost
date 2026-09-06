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
}

/**
 * Read relocatable build settings while retaining conventional paths for older builds.
 */
const loadProductionConfig = (buildDir?: string): IProductionConfig | undefined => {
  const directory = [buildDir, './build', './dist'].find(
    (candidate) => candidate && fs.existsSync(candidate),
  );

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
    )
  ) {
    throw new Error(`Invalid production configuration: ${filename}. Run ssr-boost build again.`);
  }

  return { ...config, root: path.resolve(path.dirname(filename), config.root) };
};

export type { IProductionConfig };

export default loadProductionConfig;
