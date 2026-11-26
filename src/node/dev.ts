import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Connect, InlineConfig, ViteDevServer, WsOptions } from 'vite';
import type { TCompression } from '@adapters/compression';
import getRouteAssets from '@adapters/express/route-assets';
import adapterNode from '@adapters/node';
import type { IEntryHost } from '@core/entry';
import type { TSsrHandler } from '@core/types';
import createLifecycle from '@node/lifecycle';
import type { ILifecycle, ILifecycleOptions, TLifecycleServer } from '@node/lifecycle';
import renderToStream from '@node/render-to-stream';
import { createRequestListener, resolveTlsOptions, toEntry } from '@node/server-kit';
import type { IErrorLogger } from '@node/server-kit';
import { splitHtmlShell } from '@services/diagnostics';
import ServerConfig from '@services/server-config';

interface IPrepareDevOptions {
  /** Parent HTTP(S) server; Vite attaches HMR to it instead of opening its own port. */
  server: TLifecycleServer;
  mode?: string;
  entrypointName?: string;
  isHost?: boolean;
  port?: number;
  /** Inline Vite config merged under the managed dev settings. */
  vite?: InlineConfig;
  /** An initialized config; created from the options above when omitted. */
  config?: ServerConfig;
  /** Load the server entry through Vite; tests can supply their own loader. */
  loadEntry?: (vite: ViteDevServer, file: string) => Promise<unknown>;
}

interface IDevApp {
  /** Vite's Connect stack; mount it before the handler. */
  viteMiddleware: Connect.Server;
  /** Fetch handler for documents, reloading the entry on every request. */
  handler: TSsrHandler;
  config: ServerConfig;
  vite: ViteDevServer;
  server: TLifecycleServer;
  /** Close Vite, its watcher and HMR clients; the parent server stays open. */
  close: () => Promise<void>;
}

interface ICreateDevServerOptions extends Omit<IPrepareDevOptions, 'server'>, ILifecycleOptions {
  compression?: TCompression;
  logger?: IErrorLogger;
}

interface IDevServer extends IDevApp {
  lifecycle: ILifecycle;
  listen: (port?: number, host?: string) => Promise<AddressInfo | string | null>;
}

/**
 * Vite 8.1 moved the custom HMR server from server.hmr to server.ws and warns on the old key.
 */
const hmrOption = (version: string, server: TLifecycleServer): InlineConfig['server'] => {
  const [major, minor] = version.split('.').map(Number);
  const ws = { server } as WsOptions;

  return major > 8 || (major === 8 && minor >= 1) ? { ws } : { hmr: ws };
};

/**
 * Vite's own SSR loader with mapped stack traces.
 */
const viteLoadEntry = (vite: ViteDevServer, file: string): Promise<unknown> =>
  vite.ssrLoadModule(file, { fixStacktrace: true });

/**
 * Original URL as the browser sent it; Vite strips the base from req.url in middleware mode.
 */
const originalUrl = (request: Request): string => {
  const { pathname, search } = new URL(request.url);

  return `${pathname}${search}`;
};

/**
 * Transform the dev document per request, dropping async from the client entry so plugin preambles run first.
 */
const loadDevHtml = async (config: ServerConfig, url: string): Promise<[string, string]> => {
  const vite = config.getVite()!;
  const { root, indexFile, clientFile } = config.getParams();
  const file = path.resolve(`${root}/${indexFile}`);
  const html = await readFile(file, 'utf8');
  const clientFileEntry = path.posix.normalize(`${vite.config.base}/${clientFile}`);
  const transformed = (await vite.transformIndexHtml(url, html, indexFile)).replace(
    new RegExp(
      String.raw`<script[^>]*?\bsrc=["']/?${clientFileEntry}([^"']*)["'][^>]*?\sasync\b`,
      'g',
    ),
    (match) => match.replace(/\sasync\b/, ''),
  );

  return splitHtmlShell(transformed, file);
};

/**
 * Inject the current dev graph's route assets; the manifest changes with every edit.
 */
const createDevPreparer =
  (config: ServerConfig): NonNullable<IEntryHost['prepare']> =>
  async ({ context, executionContext }) => {
    const assets = await getRouteAssets(config, context.matches, context.isSpa);
    const hints = assets.injectAssets(context, Boolean(executionContext?.onEarlyHints));

    if (hints.has('Link')) {
      await executionContext?.onEarlyHints?.(hints);
    }
  };

/**
 * Run Vite in middleware mode on a parent server and render through a defineEntry() entry.
 */
const prepareDev = async ({
  server,
  mode = 'development',
  entrypointName,
  isHost = false,
  port,
  vite: inlineConfig = {},
  config: givenConfig,
  loadEntry = viteLoadEntry,
}: IPrepareDevOptions): Promise<IDevApp> => {
  // The config exists before Vite starts, so only setVite can leave a server to close.
  const config = givenConfig ?? ServerConfig.init({ isHost, mode, entrypointName }, { port });
  const { createServer, mergeConfig, version } = await import('vite');
  const vite = await createServer(
    mergeConfig(inlineConfig, {
      mode,
      appType: 'custom',
      server: {
        middlewareMode: true,
        watch: { usePolling: true, interval: 100 },
        ...hmrOption(version, server),
      },
    }),
  );

  try {
    config.setVite(vite);
  } catch (error) {
    await vite.close();

    throw error;
  }

  const { isSPA } = config.getParams();
  const prepare = createDevPreparer(config);

  /**
   * Re-import the entry so edits to server code apply on the next request.
   */
  const ssrHandler: TSsrHandler = async (request, executionContext) => {
    const { root, serverFile } = config.getParams();
    const file = path.resolve(`${root}/${serverFile}`);
    const entry = toEntry(file, await loadEntry(config.getVite()!, file));
    const handler = entry({
      /**
       * Transform the document only when the entry renders, never for an onRequest bypass.
       */
      getHtml: async (renderRequest) => {
        const [header, footer] = await loadDevHtml(config, originalUrl(renderRequest));

        return { header, footer };
      },
      prepare,
      renderToStream,
    });

    return handler(request, executionContext);
  };

  /**
   * Client-only entrypoints get the transformed document on every route.
   */
  const spaHandler: TSsrHandler = async (request) =>
    new Response(
      request.method === 'HEAD' ? null : (await loadDevHtml(config, originalUrl(request))).join(''),
      { headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' } },
    );

  return {
    viteMiddleware: vite.middlewares,
    handler: isSPA ? spaHandler : ssrHandler,
    config,
    vite,
    server,

    /**
     * Close whichever Vite instance a restart left on the config.
     */
    close: () => config.getVite()!.close(),
  };
};

/**
 * A node:http dev server: health probes, Vite middlewares, then SSR for what Vite passed on.
 */
const createDevServer = async ({
  compression = false,
  logger,
  health,
  drainTimeoutMs,
  keepAliveTimeoutMs,
  headersTimeoutMs,
  requestTimeoutMs,
  onDrain,
  onClose,
  ...prepareOptions
}: ICreateDevServerOptions = {}): Promise<IDevServer> => {
  const { resolveConfig } = await import('vite');
  const resolved = await resolveConfig(
    { mode: prepareOptions.mode ?? 'development', ...prepareOptions.vite },
    'serve',
    prepareOptions.mode ?? 'development',
  );
  const tls = await resolveTlsOptions(resolved.server.https);
  const server = tls ? https.createServer(tls) : http.createServer();
  const app = await prepareDev({ ...prepareOptions, server });
  const render = adapterNode(app.handler, { compression });
  const lifecycle = createLifecycle(server, {
    health,
    drainTimeoutMs,
    keepAliveTimeoutMs,
    headersTimeoutMs,
    requestTimeoutMs,
    /**
     * Terminate HMR clients beside the caller's own drain work.
     */
    onDrain: async () => {
      await Promise.all([app.close(), onDrain?.()]);
    },
    onClose,
  });

  server.on(
    'request',
    createRequestListener(
      [
        lifecycle.health,

        /**
         * Hand the request to whichever Vite stack is current, so restarts keep working.
         */
        (req, res, next) => app.viteMiddleware(req, res, next),

        /**
         * Render whatever Vite passed on, from the URL the browser sent.
         */
        (req, res, next) => {
          req.url = (req as Connect.IncomingMessage).originalUrl ?? req.url;
          void render(req, res, next);
        },
      ],
      logger ?? app.config.getLogger(),
    ),
  );

  lifecycle.setReady();

  return {
    ...app,
    lifecycle,
    close: lifecycle.close,
    listen: lifecycle.listen,
  };
};

export { createDevServer, prepareDev };

export type { ICreateDevServerOptions, IDevApp, IDevServer, IPrepareDevOptions };
