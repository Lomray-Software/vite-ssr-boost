import { errorMonitor } from 'node:events';
import type { EventEmitter } from 'node:events';
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
import createLifecycle, { resolveHealthPaths, trackNativeBind } from '@node/lifecycle';
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
  // Read once by name and checked before the dev Vite starts: run() would otherwise throw with
  // that Vite left open, or read options the caller changed since. Reading by name also keeps
  // options an object inherits, as the node factories do.
  const {
    health: healthOption,
    drainTimeoutMs,
    readinessGraceMs,
    keepAliveTimeoutMs,
    headersTimeoutMs,
    requestTimeoutMs,
    onDrain,
    onClose,
  } = lifecycleOptions;
  const health = resolveHealthPaths(healthOption);

  const app = express().disable('x-powered-by');
  let lifecycle: ILifecycle | undefined;

  if (config.isProd) {
    app.set('env', 'production');
  }

  const serverApi = new ServerApi();

  config.setApp(app);

  // Created once the dev Vite is mounted, so this server loads through its own Vite.
  let prepareServer: PrepareServer;

  // A Vite this call created is closed here if the setup fails; a supplied one stays its caller's.
  let ownVite: ViteDevServer | undefined;
  // The Vite this start mounted: its drain closes this one, never a later start's.
  let mountedVite: ViteDevServer | undefined;
  // Servers run() started on the mounted Vite that still hold it; a drain finding none closes it.
  let viteUsers = 0;
  // The mounted Vite's close, started once, so every drain that closes it waits for the same one.
  let viteClosing: Promise<void> | undefined;

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

    prepareServer = PrepareServer.init(config, serverApi, mountedVite);

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
              vite: mountedVite,
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
      // A drain closed the mounted Vite: a new server would serve on a closed one.
      if (viteClosing) {
        throw new Error(
          'The dev Vite of this server was closed by a drain: call createServer again.',
        );
      }

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
      const listener = health ? healthListener : app;
      const server = isHTTPS
        ? https.createServer(transportVite!.config.server.https!, listener)
        : http.createServer(listener);

      // Set once listen() returned: a run whose listen threw never held the shared Vite.
      let isCounted = false;

      /**
       * Give up this run's hold on the shared dev Vite once. A native close does only this, as in
       * 8.6, so a later run() on the same result still serves on that Vite.
       */
      const releaseHold = (): void => {
        if (!isCounted) {
          return;
        }

        isCounted = false;
        viteUsers -= 1;
      };

      /**
       * Release this run's hold and close the shared dev Vite when no run holds it any more.
       * Decided before any await, so two drains at once never both close the Vite.
       */
      const closeViteWhenFree = (): Promise<void> | undefined => {
        releaseHold();

        const vite = viteUsers === 0 ? mountedVite : undefined;

        if (!vite) {
          return undefined;
        }

        // Assigned before vite.close() runs, so a run() from its close code is refused. A
        // synchronous throw rejects the promise, so the onClose hook still runs.
        viteClosing ??= Promise.resolve().then(() => vite.close());

        return viteClosing;
      };

      const runLifecycle = createLifecycle(server, {
        health,
        drainTimeoutMs,
        readinessGraceMs,
        keepAliveTimeoutMs,
        headersTimeoutMs,
        requestTimeoutMs,
        onDrain,
        // Vite closes after the socket drain, as in 8.6, so a response still rendering completes.
        onClose: config.isProd
          ? onClose
          : async () => {
              const closing = closeViteWhenFree();

              await settleAll(
                () => closing,
                () => onClose?.(),
              );
            },
      });

      /**
       * The listen() callback, as in 8.6: it runs before listeners added after run(),
       * so they see the state onServerStarted prepared.
       */
      const onListening = (): void => {
        // A bind that lands once the drain started is released by the lifecycle, and one that
        // lands once another drain closed the Vite is closed below: start nothing for either.
        if (runLifecycle.isDraining() || viteClosing) {
          return;
        }

        runLifecycle.setReady();
        void prepareServer.onServerStarted?.(app, serverApi, server);

        if (!isPrintInfo) {
          return;
        }

        void printServerInfo(config, { version, server, vite: transportVite });
      };

      // Node binds and reports errors itself: a bad port throws here, a bind error goes to the
      // server's error listeners or crashes the process when it has none.
      server.listen(port, host, onListening);

      // Only a server that reached listen() counts and is exposed, so a bad port keeps the last.
      if (!config.isProd) {
        isCounted = true;
        viteUsers += 1;

        // A native close() releases the hold but leaves the Vite open; during a drain the
        // lifecycle releases it after its hooks, so the Vite still closes last.
        server.on('close', () => {
          if (!runLifecycle.isDraining()) {
            releaseHold();
          }
        });

        /**
         * A failed bind emits no close: release the hold there too. The monitor leaves the error
         * to the server's own listeners, so an unhandled one still throws as Node does.
         */
        const onBindError = (): void => {
          if (!server.listening) {
            releaseHold();
          }
        };

        // The http.Server typings list only string events; errorMonitor is a symbol.
        const emitter: EventEmitter = server;

        emitter.on(errorMonitor, onBindError);

        // A server bound again after a failed bind or a native close serves on the Vite once
        // more, so it takes the hold back unless a drain started. Once another drain closed the
        // Vite, the server would serve on a closed one, so it is closed instead.
        server.on('listening', () => {
          if (isCounted || runLifecycle.isDraining()) {
            return;
          }

          if (viteClosing) {
            server.close();

            return;
          }

          isCounted = true;
          viteUsers += 1;
        });
      }

      lifecycle = runLifecycle;
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
