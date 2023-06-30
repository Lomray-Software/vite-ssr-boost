import fs from 'node:fs';
import chalk from 'chalk';
import { resolveConfig } from 'vite';

/**
 * Reset vite cache
 */
async function viteResetCache(): Promise<void> {
  const config = await resolveConfig({}, 'build');
  const { cacheDir } = config;

  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  console.info(chalk.dim(chalk.yellowBright('vite cache cleared.')));
}

export default viteResetCache;
