import http from 'node:http';
import type { RequestListener } from 'node:http';
import https from 'node:https';
import type { Server } from 'node:net';
import path from 'node:path';
import compression from 'compression';
import type { Express } from 'express';
import express from 'express';
import type { ViteDevServer } from 'vite';
import PrepareServer from '@adapters/express/prepare-server';
import type { TRender } from '@adapters/express/render';
import staticFiles from '@adapters/express/static-files';
import createDevVite from '@cli/helpers/create-dev-vite';
import printServerInfo from '@helpers/print-server-info';
import rethrowAfterCleanup from '@helpers/rethrow-after-cleanup';
import settleAll from '@helpers/settle-all';
import createLifecycle, { trackNativeBind } from '@node/lifecycle';
import type { ILifecycle, ILifecycleOptions } from '@node/lifecycle';
import ServerApi from '@services/server-api';
import type ServerConfig from '@services/server-config';

export interface ICreateServerOut {
  run: (options?: { version?: string; isPrintInfo?: boolean }) => Server;
  app: Express;
}

export interface ICreateServerResult extends ICreateServerOut {
  /** Drain, timeouts and health of the server the last run() started. */
  getLifecycle: () => ILifecycle | undefined;
}

/**
 * Create SSR server. devVite is internal to the CLI: the dev Vite it started to pick the server,
 * mounted for this one start; any other start creates its own. A prod config ignores it.
 */
async function createServer(
  config: ServerConfig,
  lifecycleOptions: ILifecycleOptions = {},
  devVite?: ViteDevServer,
): Promise<ICreateServerResult> {
  const app = express().disable('x-powered-by');
  let lifecycle: ILifecycle | undefined;

  if (config.isProd) {
    app.set('env', 'production');
  }

  const serverApi = new ServerApi();

  config.setApp(app);

  const prepareServer = PrepareServer.init(config, serverApi);

  // A Vite this call created is closed here if the setup fails; a supplied one stays its caller's.
  let ownVite: ViteDevServer | undefined;
  // The Vite this start mounted: its drain closes this one, never a later start's.
  let mountedVite: ViteDevServer | undefined;

  try {
    if (!config.isProd) {
      const vite = devVite ?? (ownVite = await createDevVite(config.mode));

      mountedVite = vite;

      /**
       * Use vite's connect instance as middleware
       */
      app.use(vite.middlewares);

      config.setVite(vite);
    }

    if (!config.getParams().isSPA) {
      await prepareServer.onAppCreated();
    }

    const { isSPA } = config.getParams();

    if (config.isProd) {
      const { root, publicDir } = config.getParams();
      const { compression: compressionConfig, expressStatic } =
        prepareServer.getMiddlewaresConfig();

      if (compressionConfig) {
        app.use(compression(compressionConfig));
      }

      if (!isSPA) {
        /**
         * ignore index.html file in SSR mode
         */
        app.use((req, _, next) => {
          if (req.url === '/index.html' && !serverApi.hasAccessIndexHtml()) {
            req.url = '/index-not-found.html';
          }

          next();
        });
      }

      if (expressStatic) {
        const { basename, ...expressStaticOpts } = expressStatic;

        app.use(
          basename!,
          staticFiles(
            path.resolve(`${root}/${publicDir}`),
            { ...expressStaticOpts, index: isSPA ? undefined : false },
            isSPA,
          ),
        );
      }
    }

    /**
     * SSR mode
     */
    if (!isSPA) {
      app.use(/(.*)/, (req, res, next) => {
        void (async () => {
          try {
            const { render, onRequest, ...renderParams } = await prepareServer.loadEntrypoint();
            const renderInput: Parameters<TRender>[1] = {
              req,
              res,
              appProps: {},
              html: { header: '', footer: '' },
            };

            await render(config, renderInput, {
              ...renderParams,
              onRequest,
              onSkip: next,
              /** Load and transform the template only after the Fetch guard allows it. */
              getHtml: async () => {
                const [header, footer] = await prepareServer.loadHtml(req);

                return { header, footer };
              },
            });
          } catch (e) {
            config
              .getLogger()
              .error(`Failed to handle request: ${(e as Error)?.message}`, { error: e as Error });
            next(e);
          }
        })();
      });
    } else {
      /**
       * SPA mode, redirect any request to index.html
       */
      app.use(/(.*)/, (req, res, next) => {
        void (async () => {
          try {
            const html = (await prepareServer.loadHtml(req)).join('');

            res.send(html);
          } catch (e) {
            config
              .getLogger()
              .error(`Failed to handle request: ${(e as Error)?.message}`, { error: e as Error });
            next(e);
          }
        })();
      });
    }
  } catch (error) {
    return rethrowAfterCleanup(error, () => ownVite?.close(), config.getLogger());
  }

  return {
    /**
     * Start the configured transport and notify the server lifecycle hook.
     */
    run: ({ version, isPrintInfo = true } = {}): Server => {
      const { port, host } = config.getParams();
      // As in 8.6, prod takes TLS options only from a Vite the caller set on the config; the CLI
      // sets none in prod, so its production server is plain HTTP.
      const transportVite = config.isProd ? config.getVite() : mountedVite;
      const isHTTPS = Boolean(transportVite?.config?.server?.https);

      /**
       * update resolved host for print network link
       */
      if (config.isHost && mountedVite) {
        mountedVite.config.server.host = host;
      }

      /**
       * Answer health probes of this server from its own lifecycle, before the application.
       */
      const healthListener: RequestListener = (req, res) =>
        runLifecycle.health(req, res, () => {
          app(req, res);
        });
      const listener = lifecycleOptions.health ? healthListener : app;
      const server = isHTTPS
        ? https.createServer(transportVite!.config.server.https!, listener)
        : http.createServer(listener);

      const { onClose } = lifecycleOptions;

      const runLifecycle = createLifecycle(server, {
        ...lifecycleOptions,
        // Vite closes after the socket drain, as in 8.6, so a response still rendering completes.
        onClose: config.isProd
          ? onClose
          : async () => {
              await settleAll(
                () => mountedVite?.close(),
                () => onClose?.(),
              );
            },
      });

      lifecycle = runLifecycle;

      /**
       * The listen() callback, as in 8.6: it runs before listeners added after run(),
       * so they see the state onServerStarted prepared.
       */
      const onListening = (): void => {
        // A bind that lands once the drain started is released by the lifecycle; start nothing.
        if (runLifecycle.isDraining()) {
          return;
        }

        runLifecycle.setReady();
        void prepareServer.onServerStarted?.(app, serverApi, server);

        if (!isPrintInfo) {
          return;
        }

        void printServerInfo(config, { version, server });
      };

      // Node binds and reports errors itself: a bad port throws here, a bind error goes to the
      // server's error listeners or crashes the process when it has none.
      server.listen(port, host, onListening);
      // A close() right after run() still waits for the port.
      trackNativeBind(runLifecycle);

      return server;
    },
    app,

    /**
     * Expose the lifecycle so the CLI can route signals and shortcuts through its drain.
     */
    getLifecycle: () => lifecycle,
  };
}

export default createServer;
