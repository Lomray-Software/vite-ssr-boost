import type { Server } from 'node:net';
import path from 'path';
import compression from 'compression';
import express from 'express';
import printServerInfo from '@helpers/print-server-info';
import type { IRequestContext } from '@node/render';
import PrepareServer from '@services/prepare-server';
import type ServerConfig from '@services/server-config';

export interface ICreateServerOut {
  run: (options?: { version?: string; isPrintInfo?: boolean }) => Server;
}

/**
 * Create SSR server
 */
async function createServer(config: ServerConfig): Promise<ICreateServerOut> {
  const app = express();

  config.setApp(app);

  if (!config.isProd) {
    // Create Vite server in middleware mode and configure the app type as
    // 'custom', disabling Vite's own HTML serving logic so parent server
    // can take control
    const vite = await (
      await import('vite')
    ).createServer({
      server: {
        middlewareMode: true,
        watch: {
          // During tests, we edit the files too fast and sometimes chokidar
          // misses change events, so enforce polling for consistency
          usePolling: true,
          interval: 100,
        },
      },
      appType: 'custom',
    });

    // Use vite's connect instance as middleware
    app.use(vite.middlewares);

    config.setVite(vite);
  } else {
    const { root, publicDir, isSPA } = config.getParams();

    app.use(compression());

    if (!isSPA) {
      // ignore index.html file in SSR mode
      app.use((req, res, next) => {
        if (req.url === '/index.html') {
          req.url = '/index-not-found.html';
        }

        next();
      });
    }

    app.use(
      express.static(path.resolve(`${root}/${publicDir}`), {
        index: isSPA ? undefined : false,
      }),
    );
  }

  const prepareServer = PrepareServer.init(config);

  // SSR mode
  if (!config.isSPA) {
    await prepareServer.onAppCreated();

    app.use('*', (req, res, next) => {
      void (async () => {
        try {
          const [
            {
              render,
              onRequest,
              onRouterReady,
              onShellReady,
              onResponse,
              onShellError,
              onError,
              getState,
            },
            clientHtml,
          ] = await Promise.all([prepareServer.loadEntrypoint(), prepareServer.loadHtml(req)]);
          const { appProps } = (await onRequest?.(req, res)) ?? {};
          const [header, footer] = clientHtml;

          const context: IRequestContext = {
            req,
            res,
            appProps: appProps ?? {},
            html: { header, footer },
          };

          await render(config, context, {
            onRouterReady,
            onShellReady,
            onShellError,
            onResponse,
            onError,
            getState,
          });
        } catch (e) {
          next(e);
        }
      })();
    });
  } else {
    // SPA mode, redirect any request to index.html
    app.use('*', (req, res, next) => {
      void (async () => {
        try {
          const html = (await prepareServer.loadHtml(req)).join('');

          res.send(html);
        } catch (e) {
          next(e);
        }
      })();
    });
  }

  return {
    run: ({ version, isPrintInfo = true } = {}): Server => {
      const { port, host } = config.getParams();

      // update resolved host for print network link
      if (config.isHost && !config.isProd) {
        config.getVite()!.config.server.host = host;
      }

      const server = app.listen(port, host, () => {
        if (!isPrintInfo) {
          return;
        }

        void printServerInfo(server, config, { version });
      });

      return server;
    },
  };
}

export default createServer;
