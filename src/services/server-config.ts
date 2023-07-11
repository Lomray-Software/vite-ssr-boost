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
  prodParams?: Partial<IConfigParams>;
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
  abortDelay: number;
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
   * @constructor
   */
  protected constructor(
    { isProd = false, isHost = false, isOnlyClient = false, mode = 'production' }: IConfigOptions,
    prodParams: Partial<IConfigParams>,
  ) {
    this.isProd = isProd;
    this.isHost = isHost;
    this.isSPA = isOnlyClient;
    this.mode = mode;
    this.prodParams = {
      root: './build',
      publicDir: '/client', // default for production,
      indexFile: '/client/index.html',
      serverFile: '/server/server.js',
      host: '127.0.0.1',
      port: 3000,
      abortDelay: 10000,
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
   * Make config params
   */
  protected makeParams(): void {
    const pluginConfig = (this.getPluginConfig() ?? {}) as Partial<IPluginConfig>;
    const { config } = this.vite ?? {};

    const root = config?.root ?? this.prodParams.root ?? '';
    const publicDir = config?.publicDir ?? this.prodParams.publicDir!;
    const dirInfo = new URL(import.meta.url);
    const pluginPath =
      pluginConfig.pluginPath ?? path.resolve(`../${path.dirname(dirInfo.pathname)}`);
    const indexFile = pluginConfig.indexFile ?? this.prodParams.indexFile!;
    const serverFile = pluginConfig.serverFile ?? this.prodParams.serverFile!;
    const host =
      typeof config?.server.host === 'boolean' || this.isHost
        ? '0.0.0.0'
        : config?.server.host ?? this.prodParams.host!;
    const port = config?.server.port ?? (this.isProd ? this.prodParams.port! : 5173);
    const abortDelay = pluginConfig.abortDelay ?? this.prodParams.abortDelay!;

    this.params = {
      root,
      publicDir,
      pluginPath,
      indexFile,
      serverFile,
      host,
      port,
      abortDelay,
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
   * Set custom abort delay
   */
  public setAbortDelay(ms: number): void {
    this.prodParams.abortDelay = ms;
    this.params.abortDelay = ms;
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
