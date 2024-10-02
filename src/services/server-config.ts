import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import type { Logger, ViteDevServer } from 'vite';
import type { IPluginConfig } from '@helpers/plugin-config';
import getPluginConfig from '@helpers/plugin-config';
import type { IBuildEntrypoint } from '@services/build';
import DefaultLogger from '@services/logger';

interface IConfigOptions {
  isProd?: boolean;
  isHost?: boolean;
  isOnlyClient?: boolean; // SPA mode
  isModulePreload?: boolean;
  mode?: string;
  entrypointName?: string;
}

interface IConfigParams {
  root: string;
  publicDir: string;
  pluginPath: string;
  isProd: boolean;
  isSPA: boolean;
  indexFile: string;
  clientFile: string;
  serverFile: string;
  host: string;
  port: number;
}

/**
 * Server config
 */
class ServerConfig {
  /**
   * Production build
   */
  public readonly isProd: boolean;

  /**
   * Server host mode
   */
  public readonly isHost: boolean;

  /**
   * Add module preload scripts to server output
   */
  public readonly isModulePreload: boolean;

  /**
   * Env mode
   */
  public readonly mode: string;

  /**
   * Run specified entrypoint
   */
  protected readonly entrypointName?: string;

  /**
   * Vite config - only for development
   */
  protected vite?: ViteDevServer;

  /**
   * Express application
   */
  protected app?: Express;

  /**
   * Config params
   */
  protected params: IConfigParams;

  /**
   * Default params
   */
  protected defaultParams: Partial<IConfigParams>;

  /**
   * Vite logger for dev mode or console for production
   */
  protected logger: Logger;

  /**
   * Default root dir
   */
  protected defaultBuildRoots = ['./build', './dist'];

  /**
   * @constructor
   */
  protected constructor(
    {
      entrypointName,
      isProd = false,
      isHost = false,
      isOnlyClient = false,
      isModulePreload = false,
      mode = 'production',
    }: IConfigOptions,
    prodParams: Partial<IConfigParams>,
  ) {
    this.isProd = isProd;
    this.isHost = isHost;
    this.isModulePreload = isModulePreload;
    this.mode = mode;
    this.entrypointName = entrypointName;
    this.defaultParams = {
      publicDir: '/client', // default for production,
      indexFile: '/client/index.html',
      serverFile: '/server/server.js',
      host: '127.0.0.1',
      isSPA: isOnlyClient,
      ...prodParams,
    };

    this.makeParams();
  }

  /**
   * Initialize service
   */
  public static init(
    options: IConfigOptions = {},
    prodOptions: Partial<IConfigParams> = {},
  ): ServerConfig {
    return new ServerConfig(options, prodOptions);
  }

  /**
   * Lookup build folder
   */
  protected getBuildDir(root?: string): string {
    for (const dir of [root, ...this.defaultBuildRoots]) {
      if (dir && fs.existsSync(dir)) {
        return dir;
      }
    }

    return root ?? this.defaultBuildRoots[0];
  }

  /**
   * Make config params
   */
  protected makeParams(): void {
    this.applyEntrypointConfig();

    const pluginConfig = (this.getPluginConfig() ?? {}) as Partial<IPluginConfig>;
    const { config } = this.vite ?? {};
    const {
      root,
      publicDir,
      indexFile,
      clientFile,
      serverFile,
      host: defaultHost,
      isSPA,
    } = this.defaultParams;
    const dirInfo = new URL(import.meta.url);
    const pluginPath =
      pluginConfig.pluginPath ?? path.resolve(path.dirname(dirInfo.pathname), '../');
    const entrypoint = this.getEntrypoint();

    const host =
      typeof config?.server.host === 'boolean' || this.isHost
        ? '0.0.0.0'
        : (config?.server.host ?? defaultHost!);
    const port = Number(config?.env.VITE_PORT ?? config?.server.port ?? this.defaultParams.port!);

    this.params = {
      root: config?.root ?? this.getBuildDir(root),
      publicDir: config?.publicDir ?? publicDir!,
      indexFile: pluginConfig.indexFile ?? indexFile!,
      clientFile: pluginConfig.clientFile ?? clientFile!,
      serverFile: pluginConfig.serverFile ?? serverFile!,
      pluginPath,
      host,
      port,
      isSPA: entrypoint ? entrypoint.type === 'spa' : isSPA!,
      isProd: this.isProd,
    };
    this.logger = this.vite?.config.logger ?? new DefaultLogger();
  }

  /**
   * Set vite server
   */
  public setVite(vite: ViteDevServer): void {
    this.vite = vite;

    this.makeParams();
  }

  /**
   * Set express server
   */
  public setApp(express: Express): void {
    this.app = express;
  }

  /**
   * Return vite dev server
   * NOTE: only on development mode
   */
  public getVite(): ViteDevServer | undefined {
    return this.vite;
  }

  /**
   * Return express server
   */
  public getApp(): Express | undefined {
    return this.app;
  }

  /**
   * Return plugin config
   * NOTE: only on development mode
   */
  public getPluginConfig(): IPluginConfig | undefined {
    return this.vite ? getPluginConfig(this.vite.config) : undefined;
  }

  /**
   * Return config params
   */
  public getParams(): IConfigParams {
    return this.params;
  }

  /**
   * Get server logger
   */
  public getLogger(): Logger {
    return this.logger;
  }

  /**
   * Set custom logger
   */
  public setLogger(logger: Logger): void {
    this.logger = logger;
  }

  /**
   * Apply config to specified entrypoint
   */
  protected applyEntrypointConfig(): void {
    const config = this.getPluginConfig();

    if (!this.vite || !config || !this.entrypointName) {
      return;
    }

    const entrypointConfig = this.getEntrypoint();

    // apply specified entrypoint config
    if (entrypointConfig) {
      (['indexFile', 'clientFile', 'serverFile'] as const).forEach((optName) => {
        if (entrypointConfig[optName]) {
          config[optName] = entrypointConfig[optName]!;
        }
      });
    }
  }

  /**
   * Get current entrypoint
   */
  protected getEntrypoint(): IBuildEntrypoint | undefined {
    const config = this.vite ? getPluginConfig(this.vite.config) : undefined;

    return config?.entrypoint?.find(({ name }) => name === this.entrypointName);
  }
}

export default ServerConfig;
