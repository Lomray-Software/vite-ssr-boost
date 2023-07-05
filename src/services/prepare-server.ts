import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import type { IEntrypointOptions, IPrepareRenderOut } from '@node/entry';
import type { TRender } from '@node/render';
import type ServerConfig from '@services/server-config';

interface IPrepareServerEntrypointLoadOut<TAppProps = Record<string, any>> {
  render: TRender;
  onRequest?: IEntrypointOptions<TAppProps>['onRequest'];
  onRouterReady?: IEntrypointOptions<TAppProps>['onRouterReady'];
  onShellReady?: IEntrypointOptions<TAppProps>['onShellReady'];
  onShellError?: IEntrypointOptions<TAppProps>['onShellError'];
  onResponse?: IEntrypointOptions<TAppProps>['onResponse'];
  onError?: IEntrypointOptions<TAppProps>['onError'];
  getState?: IEntrypointOptions<TAppProps>['getState'];
}

/**
 *  Load server entrypoint and template
 *  DEV MODE: refresh entrypoint and template
 */
class PrepareServer {
  /**
   * Server configuration
   */
  protected readonly config: ServerConfig;

  /**
   * Entrypoint resolved params
   */
  protected entrypoint?: IPrepareServerEntrypointLoadOut;

  /**
   * Hook which calls after express server created
   */
  protected onServerCreated?: IEntrypointOptions['onServerCreated'];

  /**
   * Html shell
   */
  protected html: string;

  /**
   * @constructor
   * @protected
   */
  protected constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Init service
   */
  public static init(config: ServerConfig): PrepareServer {
    return new PrepareServer(config);
  }

  /**
   * Resolve and return entrypoint params
   */
  public async loadEntrypoint(): Promise<IPrepareServerEntrypointLoadOut> {
    // load server entrypoint each time only in development mode (for fast refresh)
    if (this.entrypoint && this.config.isProd) {
      return this.entrypoint;
    }

    const { root, isProd, serverFile } = this.config.getParams();
    const entrypointPath = path.resolve(`${root}/${serverFile}`);

    let resolvedEntrypoint: IPrepareRenderOut;

    if (!isProd) {
      resolvedEntrypoint = (
        await this.config.getVite()!.ssrLoadModule(entrypointPath, {
          fixStacktrace: true,
        })
      ).default;
    } else {
      resolvedEntrypoint = (await import(entrypointPath)).default;
    }

    const { render, init } = resolvedEntrypoint;
    const {
      onServerCreated,
      onRequest,
      onRouterReady,
      onShellReady,
      onResponse,
      onShellError,
      onError,
      getState,
    } =
      (await init?.({
        config: this.config,
      })) ?? {};

    this.entrypoint = {
      render,
      onRequest,
      onRouterReady,
      onShellReady,
      onShellError,
      onResponse,
      onError,
      getState,
    };
    this.onServerCreated = onServerCreated;

    return this.entrypoint;
  }

  /**
   * Load and return html shell
   */
  public async loadHtml(req: Request): Promise<[string, string]> {
    const { isProd, root, indexFile } = this.config.getParams();

    if (!this.html || !isProd) {
      this.html = fs.readFileSync(path.resolve(`${root}/${indexFile}`), 'utf-8');
    }

    let modifiedHtml = this.html;

    if (!isProd) {
      // Apply Vite HTML transforms. This injects the Vite HMR client,
      // and also applies HTML transforms from Vite plugins, e.g. global
      // preambles from @vitejs/plugin-react
      modifiedHtml = (await this.config.getVite()!.transformIndexHtml(req.originalUrl, this.html))
        // Make vite script 'async'
        .replace(/(<script.+)(>[\s\S]+injectIntoGlobalHook.+)/, '$1async$2');
    }

    return modifiedHtml.split('<!--ssr-outlet-->') as [string, string];
  }

  /**
   * Run server created hook
   */
  public async onAppCreated(): Promise<PrepareServer> {
    await this.loadEntrypoint();
    await this.onServerCreated?.(this.config.getApp()!);

    return this;
  }
}

export default PrepareServer;
