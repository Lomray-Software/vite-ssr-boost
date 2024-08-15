import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { ResolvedConfig } from 'vite';
import { resolveConfig } from 'vite';
import viteResetCache from '@cli/helpers/vite-reset-cache';
import { createDevMarker } from '@helpers/dev-marker';
import type { IPluginConfig } from '@helpers/plugin-config';
import getPluginConfig from '@helpers/plugin-config';
import processStop from '@helpers/process-stop';
import { readMeta, removeMeta } from '@helpers/ssr-meta';
import ServerConfig from '@services/server-config';
import SsrManifest from '@services/ssr-manifest';

export interface IBuildParams {
  mode: string;
  onFinish?: () => void;
  clientOptions?: string;
  serverOptions?: string;
  isOnlyClient?: boolean;
  isWatch?: boolean;
  isUnlockRobots?: boolean;
  isEject?: boolean;
  isServerless?: boolean;
  isNoWarnings?: boolean;
}

interface IBuildProcess {
  promise: Promise<number | null | string>;
  command: childProcess.ChildProcess;
}

interface ISpawnBuildParams {
  shouldWait?: boolean;
}

/**
 * Build service
 */
class Build {
  /**
   * Is production build
   */
  protected isProd: boolean;

  /**
   * Node environment
   */
  protected nodeEnv: string;

  /**
   * Build folder
   */
  protected buildDir: string;

  /**
   * Vite config
   */
  protected viteConfig: ResolvedConfig;

  /**
   * Plugin config
   */
  protected pluginConfig: IPluginConfig;

  /**
   * Build params
   */
  protected params: IBuildParams = {
    mode: '',
    clientOptions: '',
    serverOptions: '',
    isOnlyClient: false,
    isWatch: false,
    isUnlockRobots: false,
    isEject: false,
    isServerless: false,
    isNoWarnings: false,
  };

  /**
   * Abort controller for builds
   */
  protected abortController: AbortController | null = null;

  /**
   * Running builds
   */
  protected runningBuild: { name: string; buildProcess: IBuildProcess }[] = [];

  /**
   * Listener for preview has attached
   */
  protected hasPreviewModeExitListener = false;

  /**
   * @constructor
   */
  public constructor(params: IBuildParams) {
    this.params = params;
  }

  /**
   * Make config
   */
  protected async makeConfig(): Promise<void> {
    const { mode } = this.params;

    this.viteConfig = await resolveConfig({}, 'build', mode, 'production');
    this.pluginConfig = getPluginConfig(this.viteConfig);
    this.buildDir = path.resolve(this.viteConfig.root, this.viteConfig.build.outDir);
    this.nodeEnv = process.env.NODE_ENV || 'production';
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
   * Return is prod indicator value
   */
  public getIsProd(): boolean {
    return this.isProd;
  }

  /**
   * Return node env value
   */
  public getNodeEnv(): string {
    return this.nodeEnv;
  }

  /**
   * Return build names
   */
  public getRunningBuildNames(): string[] {
    return this.runningBuild.map(({ name }) => name);
  }

  /**
   * Promisify spawn process
   */
  protected promisifyProcess(
    command: childProcess.ChildProcess,
    isRejectWarnings = false,
  ): IBuildProcess {
    const promise = new Promise<number | null | string>((resolve, reject): void => {
      command.on('exit', (code) => {
        resolve(code);
      });

      command.on('close', (code: number): void => {
        resolve(code);
      });

      command.on('error', (message: string): void => {
        reject(message);
      });

      if (isRejectWarnings) {
        command.stderr?.on('data', (buff: Uint8Array): void => {
          const msg = Buffer.from(buff).toString();

          if (msg.includes('warning') || msg.includes('WARNING')) {
            resolve(1);
          }
        });
      }
    });

    command.stdout?.pipe(process.stdout);
    command.stderr?.pipe(process.stderr);

    return { promise, command };
  }

  /**
   * Build assets manifest file
   */
  protected async buildManifest(): Promise<void> {
    console.info(chalk.blue(`Building routes manifest file: ${this.pluginConfig.routesParsing}`));

    const isNodeParsing = this.pluginConfig.routesParsing === 'node';
    const serverConfig = ServerConfig.init(
      { isProd: this.isProd, mode: this.params.mode },
      { root: this.viteConfig.root, clientFile: this.pluginConfig.clientFile },
    );

    await SsrManifest.get(serverConfig, {
      buildDir: this.viteConfig.build.outDir,
      viteAliases: this.viteConfig.resolve.alias,
    }).buildRoutesManifest(isNodeParsing);

    if (isNodeParsing) {
      this.cleanupClientRoutes();
    }
  }

  /**
   * Remove pathId from client route files
   */
  private cleanupClientRoutes(): void {
    const { routeFiles } = readMeta(this.buildDir);
    const files = new Set(Object.values(routeFiles ?? []));

    if (!files.size) {
      return;
    }

    files.forEach((file) => {
      const filepath = `${this.buildDir}/client/${file}`;

      try {
        const result = fs
          .readFileSync(filepath, { encoding: 'utf-8' })
          .replace(/(lazy:.*?\((.*?)\)),\s?".*?"\)/g, '$1)');

        fs.writeFileSync(filepath, result);
      } catch (e) {
        console.log(`Failed cleanup client route ${filepath}:`, e);
      }
    });
  }

  /**
   * Change general directive Disallow to Allow in robots.txt.
   */
  protected unlockRobots(): void {
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
  protected eject(): void {
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

  /**
   * Create serverless entrypoint
   */
  protected createServerless(): void {
    const entrypoint = `${this.buildDir}/server/serverless.js`;
    const script =
      "import runServerless from '@lomray/vite-ssr-boost/cli/run-serverless.js';\n\n" +
      `export default await runServerless({ version: process.env.VERSION || "1.0.0" });\n`;

    fs.writeFileSync(entrypoint, script, {
      encoding: 'utf-8',
    });
  }

  /**
   * Build specified entrypoint
   */
  protected async spawnBuild(
    name: string,
    buildOptions: string,
    params: ISpawnBuildParams = {},
  ): Promise<void> {
    const { mode, isOnlyClient, isNoWarnings } = this.params;
    const { shouldWait = false } = params;
    const modeOpt = mode ? `--mode ${mode}` : '';

    const buildProcess = this.promisifyProcess(
      childProcess.spawn(`vite build ${buildOptions} ${modeOpt} --emptyOutDir`, {
        signal: this.abortController!.signal,
        stdio: [process.stdin, 'pipe', 'pipe'],
        shell: true,
        env: {
          ...process.env,
          FORCE_COLOR: '2',
          SSR_BOOST_IS_SSR: isOnlyClient ? '0' : '1',
          SSR_BOOST_ACTION: global.viteBoostAction,
        },
      }),
      isNoWarnings,
    );

    this.runningBuild.push({ name, buildProcess });

    if (!shouldWait) {
      return;
    }

    await this.waitLastBuild();
  }

  /**
   * Wait latest build and stop process in case error
   */
  protected async waitLastBuild(): Promise<void> {
    const latestProcess = this.runningBuild.at(-1);

    if (!latestProcess) {
      return;
    }

    const exitCode = await latestProcess.buildProcess.promise;

    processStop(exitCode, true);
  }

  /**
   * Run preview mode
   */
  protected runPreviewMode(): void {
    if (!this.hasPreviewModeExitListener) {
      process.on('exit', () => {
        this.abortController!.abort();
      });

      this.hasPreviewModeExitListener = true;
    }

    const { onFinish } = this.params;
    let buildCount = this.runningBuild.length;

    /**
     * Detect finished builds for process
     */
    const listener = (buff: Uint8Array): void => {
      const msg = Buffer.from(buff).toString();

      if (msg.includes('built in')) {
        buildCount -= 1;

        if (!buildCount) {
          this.runningBuild.forEach(({ buildProcess }) => {
            buildProcess.command.stdout?.removeListener('data', listener);
          });
          createDevMarker(this.isProd, this.viteConfig);
          onFinish?.();
        }
      }
    };

    /**
     * Listen output for call onFinish
     */
    this.runningBuild.forEach(({ buildProcess }) => {
      buildProcess.command.stdout?.on('data', listener);
    });
  }

  /**
   * Run app build
   */
  public async build(): Promise<void> {
    await this.makeConfig();
    // this is required step - build with different env may cause problems
    await viteResetCache();
    this.clearBuildFolder();

    const {
      clientOptions,
      serverOptions,
      onFinish,
      isWatch,
      isOnlyClient,
      isEject,
      isServerless,
      isUnlockRobots,
    } = this.params;
    const { outDir } = this.viteConfig.build;

    this.abortController = new AbortController();
    this.runningBuild = [];

    /**
     * Build client
     */
    await this.spawnBuild('client', `${clientOptions} --outDir ${outDir}/client`, {
      shouldWait: !isWatch,
    });

    /**
     * Build server
     */
    if (!isOnlyClient) {
      await this.spawnBuild(
        'server',
        `${serverOptions} --outDir ${outDir}/server --ssr ${this.pluginConfig.serverFile}`,
        {
          shouldWait: !isWatch,
        },
      );

      if (!isWatch) {
        await this.buildManifest();

        if (isEject) {
          this.eject();
        }

        if (isServerless) {
          this.createServerless();
        }
      }
    }

    /**
     * Build additional endpoints
     */

    /**
     * Preview mode
     */
    if (isWatch) {
      this.runPreviewMode();

      return;
    }

    if (isUnlockRobots) {
      this.unlockRobots();
    }

    createDevMarker(this.isProd, this.viteConfig);
    removeMeta(this.buildDir);
    onFinish?.();
  }
}

export default Build;
