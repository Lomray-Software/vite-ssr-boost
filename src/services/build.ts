import type childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { ResolvedConfig } from 'vite';
import { resolveConfig } from 'vite';
import type { IPluginConfig } from '@helpers/plugin-config';
import getPluginConfig from '@helpers/plugin-config';
import SsrManifest from '@services/ssr-manifest';

interface IBuildParams {
  mode: string;
}

/**
 * Build service
 */
class Build {
  /**
   * Is production build
   */
  public isProd: boolean;

  /**
   * Node environment
   */
  public nodeEnv: string;

  /**
   * Build folder
   */
  public buildDir: string;

  /**
   * Relative build dir
   */
  public outDir: string;

  /**
   * Server file
   */
  public serverFile: string;

  /**
   * Vite config
   */
  public viteConfig: ResolvedConfig;

  /**
   * Plugin config
   */
  public pluginConfig: IPluginConfig;

  /**
   * Build params
   */
  protected params: IBuildParams;

  /**
   * @constructor
   */
  constructor(params: IBuildParams) {
    this.params = params;
  }

  /**
   * Make config
   */
  public async makeConfig(): Promise<void> {
    const { mode } = this.params;

    this.viteConfig = await resolveConfig(
      {},
      'build',
      mode,
      mode === 'production' ? 'production' : 'development',
    );
    this.pluginConfig = getPluginConfig(this.viteConfig);
    this.buildDir = path.resolve(this.viteConfig.root, this.viteConfig.build.outDir);
    this.outDir = this.viteConfig.build.outDir;
    this.serverFile = this.pluginConfig.serverFile;
    this.nodeEnv = process.env.NODE_ENV || 'development';
    this.isProd = this.nodeEnv === 'production';
  }

  /**
   * Clear build folder
   */
  public clearBuildFolder(): void {
    // clear build folder
    if (fs.existsSync(this.buildDir)) {
      fs.rmSync(this.buildDir, { recursive: true });
    }
  }

  /**
   * Promisify spawn process
   */
  public promisifyProcess(command: childProcess.ChildProcess): Promise<unknown> {
    const promise = new Promise((resolve, reject) => {
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

    command.stdout?.pipe(process.stdout);
    command.stderr?.pipe(process.stderr);

    promise['command'] = command;

    return promise;
  }

  /**
   * Build assets manifest file
   */
  public async buildManifest(): Promise<void> {
    await SsrManifest.get(this.viteConfig.root, {
      alias: this.viteConfig.resolve.alias,
      buildDir: this.viteConfig.build.outDir,
    }).buildRoutesManifest(this.pluginConfig.preloadAssets);
  }

  /**
   * Change general directive Disallow to Allow in robots.txt.
   */
  public unlockRobots(): void {
    const robotsFile = `${this.buildDir}/client/robots.txt`;

    if (!fs.existsSync(robotsFile)) {
      console.warn(`Failed to unlock robots.txt, file not exist: ${robotsFile}`);

      return;
    }

    const data = fs
      .readFileSync(robotsFile, { encoding: 'utf-8' })
      .replace(/Disallow: \/$/m, 'Allow: /');

    fs.writeFileSync(robotsFile, data, { encoding: 'utf-8' });

    console.info(chalk.blue('\nrobots.txt unlocked.'));
  }

  /**
   * Eject cli to run app via node
   */
  public eject(): void {
    const entrypoint = `${this.buildDir}/server/start.js`;
    const script =
      "import runProd from '@lomray/vite-ssr-boost/cli/run-prod.js';\n\n" +
      'const VERSION = process.env.VERSION || "1.0.0";\n' +
      'const PORT = process.env.PORT || 3000;\n' +
      'const IS_HOST = process.env.IS_HOST || "0";\n' +
      'const ONLY_CLIENT = process.env.ONLY_CLIENT || "0";\n\n' +
      `await runProd({
        version: VERSION,
        isHost: IS_HOST === '1',
        isPrintInfo: true,
        port: PORT,
        onlyClient: ONLY_CLIENT === '1',
      });\n`;

    fs.writeFileSync(entrypoint, script, {
      encoding: 'utf-8',
    });
  }
}

export default Build;
