import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import type { Logger, ViteDevServer } from 'vite';
import type { IPluginConfig } from '@helpers/plugin-config';
import getPluginConfig from '@helpers/plugin-config';
import DefaultLogger from '@services/logger';

interface IConfigOptions {
  isProd?: boolean;
  isHost?: boolean;
  isOnlyClient?: boolean; // SPA mode
  isModulePreload?: boolean;
  mode?: string;
}

interface IConfigParams {
  root: string;
  publicDir: string;
  pluginPath: string;
  isProd: boolean;
  isSPA: boolean;
  indexFile: string;
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
   * SPA mode
   */
  public readonly isSPA: boolean;

  /**
   * Env mode
   */
  public readonly mode: string;

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
   * Default production params
   */
  protected prodParams: Partial<IConfigParams>;

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
    this.isSPA = isOnlyClient;
    this.isModulePreload = isModulePreload;
    this.mode = mode;
    this.prodParams = {
      publicDir: '/client', // default for production,
      indexFile: '/client/index.html',
      serverFile: '/server/server.js',
      host: '127.0.0.1',
      port: 3000,
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
    const pluginConfig = (this.getPluginConfig() ?? {}) as Partial<IPluginConfig>;
    const { config } = this.vite ?? {};

    const root = config?.root ?? this.getBuildDir(this.prodParams.root);
    const publicDir = config?.publicDir ?? this.prodParams.publicDir!;
    const dirInfo = new URL(import.meta.url);
    const pluginPath =
      pluginConfig.pluginPath ?? path.resolve(path.dirname(dirInfo.pathname), '../');
    const indexFile = pluginConfig.indexFile ?? this.prodParams.indexFile!;
    const serverFile = pluginConfig.serverFile ?? this.prodParams.serverFile!;
    const host =
      typeof config?.server.host === 'boolean' || this.isHost
        ? '0.0.0.0'
        : config?.server.host ?? this.prodParams.host!;
    const port = config?.server.port ?? (this.isProd ? this.prodParams.port! : 5173);

    this.params = {
      root,
      publicDir,
      pluginPath,
      indexFile,
      serverFile,
      host,
      port,
      isSPA: this.isSPA,
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
   * return plugin config
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
}

export default ServerConfig;
