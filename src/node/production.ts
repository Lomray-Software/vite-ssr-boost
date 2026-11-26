import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { ServerOptions as HttpsServerOptions } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TCompression } from '@adapters/compression';
import adapterNode from '@adapters/node';
import type { ICreateHandlerOptions, IHtmlShell } from '@core/handler';
import type { TSsrHandler } from '@core/types';
import createLifecycle from '@node/lifecycle';
import type { ILifecycle, ILifecycleOptions, TLifecycleServer } from '@node/lifecycle';
import renderToStream from '@node/render-to-stream';
import serveStatic from '@node/serve-static';
import type { IServeStaticOptions, TStaticMiddleware } from '@node/serve-static';
import { createRequestListener, toEntry } from '@node/server-kit';
import type { IErrorLogger } from '@node/server-kit';
import { splitHtmlShell } from '@services/diagnostics';
import DefaultLogger from '@services/logger';
import loadProductionConfig, {
  DEFAULT_BUILD_DIRS,
  findBuildDir,
  loadFingerprintedFiles,
} from '@services/production-config';
import createAssetPreparer from '@services/route-asset-preparer';
import RouteAssets from '@services/route-assets';
import type { TRouteAssetsManifest } from '@services/route-assets';

interface ILoadHtmlShellOptions {
  indexFile: string;
  outlet?: string;
}

type TRouteAssetPreparerOptions = (
  { buildDir: string; manifest?: never } | { manifest: TRouteAssetsManifest; buildDir?: never }
) & { modulePreload?: boolean };

/**
 * Read a built document once and supply a fresh shell for each request.
 */
const loadHtmlShell = async ({
  indexFile,
  outlet = '<!--ssr-outlet-->',
}: ILoadHtmlShellOptions): Promise<() => IHtmlShell> => {
  const html = await readFile(indexFile, 'utf8');
  const [header, footer] = splitHtmlShell(html, indexFile, outlet);

  return () => ({ header, footer });
};

/**
 * Inject matched route assets using a manifest cache owned by this preparer.
 */
const createRouteAssetPreparer = <TAppProps = Record<string, any>>({
  buildDir,
  manifest,
  modulePreload = false,
}: TRouteAssetPreparerOptions): NonNullable<ICreateHandlerOptions<TAppProps>['prepare']> => {
  return createAssetPreparer(new RouteAssets(manifest ?? buildDir, modulePreload));
};

type TStaticOptions = Omit<
  IServeStaticOptions,
  'root' | 'basename' | 'isSPA' | 'hasAccessIndexHtml'
>;

interface IPrepareProductionOptions {
  /** Build output; without one `./build` and then `./dist` are tried. */
  buildDir?: string;
  modulePreload?: boolean;
  /** Client-only build: files and the document are served without a server entry. */
  isSPA?: boolean;
  /** serve-static options for the client directory; `false` leaves files to the host. */
  static?: TStaticOptions | false;
  /** SSR builds hide the raw `/index.html` shell unless this returns true. */
  hasAccessIndexHtml?: () => boolean;
  /** Import the built server entry; tests and bundlers can supply their own loader. */
  loadEntry?: (file: string) => Promise<unknown>;
}

interface IProductionPaths {
  root: string;
  base: string;
  publicDir: string;
  indexFile: string;
  serverFile: string;
}

interface IProductionApp {
  /** Fetch handler for documents: SSR, or the SPA document in client-only builds. */
  handler: TSsrHandler;
  /** Connect middleware for client files; undefined when static serving is disabled. */
  staticMiddleware?: TStaticMiddleware;
  paths: IProductionPaths;
}

interface ICreateProductionServerOptions extends IPrepareProductionOptions, ILifecycleOptions {
  /** Compress rendered documents; static files and CDN-owned compression are left alone. */
  compression?: TCompression;
  /** Serve HTTPS with these TLS options. */
  https?: HttpsServerOptions;
  logger?: IErrorLogger;
}

interface IProductionServer extends IProductionApp {
  server: TLifecycleServer;
  lifecycle: ILifecycle;
  listen: (port?: number, host?: string) => Promise<AddressInfo | string | null>;
  close: () => Promise<void>;
}

const DEFAULT_PATHS: Omit<IProductionPaths, 'root'> = {
  base: '/',
  publicDir: 'client',
  indexFile: 'client/index.html',
  serverFile: 'server/server.js',
};

/**
 * Resolve build paths from ssr-boost.json, falling back to the conventional layout.
 */
const resolvePaths = (buildDir?: string): IProductionPaths => {
  const config = loadProductionConfig(buildDir);
  const root = config?.root ?? path.resolve(findBuildDir(buildDir) ?? DEFAULT_BUILD_DIRS[0]);
  const paths = config ?? DEFAULT_PATHS;

  return {
    root,
    base: paths.base,
    publicDir: path.join(root, paths.publicDir),
    indexFile: path.join(root, paths.indexFile),
    serverFile: path.join(root, paths.serverFile),
  };
};

/**
 * Native import of the built server module.
 */
const importEntry = (file: string): Promise<unknown> => import(pathToFileURL(file).href);

/**
 * Load the defineEntry() export and explain the two ways a wrong build can reach this host.
 */
const loadServerEntry = async (
  file: string,
  loadEntry: NonNullable<IPrepareProductionOptions['loadEntry']>,
) => {
  let module: { default?: unknown } | undefined;

  try {
    module = (await loadEntry(file)) as { default?: unknown } | undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' && !existsSync(file)) {
      throw new Error(
        `[ssr-boost] Server entry not found: ${file}. Run ssr-boost build or pass the build directory.`,
        { cause: error },
      );
    }

    throw error;
  }

  return toEntry(file, module);
};

/**
 * Serve the client-only document for every route the file server skipped.
 */
const createSpaHandler = async (indexFile: string): Promise<TSsrHandler> => {
  const html = await readFile(indexFile, 'utf8');

  return (request) =>
    Promise.resolve(
      new Response(request.method === 'HEAD' ? null : html, {
        headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
};

/**
 * Turn a build directory into a document handler and a client file middleware.
 */
const prepareProduction = async ({
  buildDir,
  modulePreload = false,
  isSPA = false,
  static: staticOptions = {},
  hasAccessIndexHtml,
  loadEntry = importEntry,
}: IPrepareProductionOptions = {}): Promise<IProductionApp> => {
  const paths = resolvePaths(buildDir);
  let handler: TSsrHandler;

  if (isSPA) {
    handler = await createSpaHandler(paths.indexFile);
  } else {
    const entry = await loadServerEntry(paths.serverFile, loadEntry);

    handler = entry({
      getHtml: await loadHtmlShell({ indexFile: paths.indexFile }),
      prepare: createRouteAssetPreparer({ buildDir: paths.root, modulePreload }),
      renderToStream,
    });
  }

  return {
    handler,
    paths,
    staticMiddleware:
      staticOptions === false
        ? undefined
        : serveStatic({
            ...staticOptions,
            immutableFiles: staticOptions.immutableFiles ?? loadFingerprintedFiles(paths.root),
            root: paths.publicDir,
            basename: new URL(paths.base, 'http://localhost').pathname,
            isSPA,
            hasAccessIndexHtml,
          }),
  };
};

/**
 * A node:http server running a production build without Express.
 * Order: health probes, client files, then SSR, which receives only what the file server skipped.
 */
const createProductionServer = async ({
  compression = false,
  https: tls,
  logger = new DefaultLogger(),
  health,
  drainTimeoutMs,
  keepAliveTimeoutMs,
  headersTimeoutMs,
  requestTimeoutMs,
  onDrain,
  onClose,
  ...prepareOptions
}: ICreateProductionServerOptions = {}): Promise<IProductionServer> => {
  const app = await prepareProduction(prepareOptions);
  const render = adapterNode(app.handler, { compression });
  const server = tls ? https.createServer(tls) : http.createServer();
  const lifecycle = createLifecycle(server, {
    health,
    drainTimeoutMs,
    keepAliveTimeoutMs,
    headersTimeoutMs,
    requestTimeoutMs,
    onDrain,
    onClose,
  });

  server.on(
    'request',
    createRequestListener(
      [
        lifecycle.health,
        app.staticMiddleware,

        /**
         * Render whatever the file server did not answer.
         */
        (req, res, next) => void render(req, res, next),
      ],
      logger,
    ),
  );

  lifecycle.setReady();

  return {
    ...app,
    server,
    lifecycle,
    close: lifecycle.close,
    listen: lifecycle.listen,
  };
};

export {
  createLifecycle,
  createProductionServer,
  createRouteAssetPreparer,
  loadHtmlShell,
  prepareProduction,
  serveStatic,
};

export type {
  ICreateProductionServerOptions,
  IHtmlShell,
  ILifecycle,
  ILifecycleOptions,
  ILoadHtmlShellOptions,
  IPrepareProductionOptions,
  IProductionApp,
  IProductionPaths,
  IProductionServer,
  IServeStaticOptions,
  TRouteAssetPreparerOptions as IRouteAssetPreparerOptions,
  TRouteAssetsManifest,
  TStaticMiddleware,
};
