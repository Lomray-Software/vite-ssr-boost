import type { FC, PropsWithChildren } from 'react';
import { createElement } from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler } from 'react-router';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions, IHtmlShell } from '@core/handler';
import headResponse from '@core/head-response';
import type { ISsrExecutionContext } from '@core/types';
import renderToStream from '@edge/render-to-stream';
import type { TRouteObject } from '@interfaces/route-object';
import { splitHtmlShell } from '@services/diagnostics';
import createAssetPreparer from '@services/route-asset-preparer';
import RouteAssets from '@services/route-assets-memory';
import type { TRouteAssetsManifest } from '@services/route-assets-memory';

/** Structural types keep Cloudflare's global declarations optional for consumers. */
export interface IAssetsBinding {
  fetch: (request: Request) => Promise<Response>;
}

export interface IWorkerContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface IWorkerPlatform<TEnv = Record<string, unknown>> {
  env: TEnv;
  ctx: IWorkerContext;
}

export interface IWorkerExecutionContext<TEnv> extends ISsrExecutionContext<IWorkerPlatform<TEnv>> {
  platform: IWorkerPlatform<TEnv>;
  waitUntil: IWorkerContext['waitUntil'];
}

export type TWorkerHandler<TEnv = Record<string, unknown>> = (
  request: Request,
  env: TEnv,
  ctx: IWorkerContext,
) => Promise<Response>;

type TWorkerHtml<TEnv> =
  | {
      getHtml: (
        request: Request,
        env: TEnv,
        ctx: IWorkerContext,
      ) => IHtmlShell | Promise<IHtmlShell>;
      indexHtml?: never;
    }
  | { indexHtml: string; getHtml?: never };

export type IWorkerHandlerOptions<
  TEnv = Record<string, unknown>,
  TAppProps = Record<string, any>,
> = Omit<ICreateHandlerOptions<TAppProps>, 'getHtml' | 'onRequest'> &
  TWorkerHtml<TEnv> & {
    routes: TRouteObject[];
    App: FC<PropsWithChildren<{ server: TAppProps }>>;
    manifest: TRouteAssetsManifest;
    /** Assets binding name, or false to delegate static delivery elsewhere. Default: ASSETS. */
    assets?: string | false;
    modulePreload?: boolean;
    outlet?: string;
    routerOptions?: Parameters<typeof createStaticHandler>[1];
    onRequest?: (params: {
      request: Request;
      executionContext: IWorkerExecutionContext<TEnv>;
    }) => ReturnType<NonNullable<ICreateHandlerOptions<TAppProps>['onRequest']>>;
  };

const CACHE_CONTROL = 'Cache-Control';

const htmlCache = new WeakMap<object, Map<string, Promise<() => IHtmlShell>>>();

/**
 * Resolve a named static assets binding with an actionable configuration error.
 */
const getAssetsBinding = (env: object, name: string): IAssetsBinding => {
  const binding = Reflect.get(env, name) as IAssetsBinding | undefined;

  if (!binding || typeof binding.fetch !== 'function') {
    throw new Error(`[ssr-boost] Missing Workers assets binding "${name}".`);
  }

  return binding;
};

/**
 * Fetch and split the built HTML once per binding and path, returning fresh request shells.
 * Failed loads are evicted so a transient binding error does not poison the isolate.
 */
export const getHtmlFromAssets = async (
  env: object,
  indexPath = '/index.html',
  bindingName = 'ASSETS',
  outlet = '<!--ssr-outlet-->',
): Promise<() => IHtmlShell> => {
  const binding = getAssetsBinding(env, bindingName);
  let cache = htmlCache.get(binding);

  if (!cache) {
    cache = new Map();
    htmlCache.set(binding, cache);
  }

  const key = JSON.stringify([indexPath, outlet]);
  let pending = cache.get(key);

  if (!pending) {
    pending = (async () => {
      const response = await binding.fetch(new Request(new URL(indexPath, 'https://assets.local')));

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `[ssr-boost] Failed to load "${indexPath}" from assets: ${response.status}.`,
        );
      }

      const [header, footer] = splitHtmlShell(await response.text(), indexPath, outlet);

      return () => ({ header, footer });
    })();
    cache.set(key, pending);
    void pending.catch(() => cache.delete(key));
  }

  return pending;
};

/**
 * Create a Fetch Worker with in-memory route assets and the Web stream renderer.
 */
export const createWorkerHandler = <
  TEnv extends object = Record<string, unknown>,
  TAppProps = Record<string, any>,
>({
  routes,
  App,
  manifest,
  getHtml,
  indexHtml,
  assets = 'ASSETS',
  modulePreload = false,
  outlet = '<!--ssr-outlet-->',
  routerOptions,
  onRequest,
  onRouterReady,
  onShellReady,
  prepare,
  ...options
}: IWorkerHandlerOptions<TEnv, TAppProps>): TWorkerHandler<TEnv> => {
  const handler = createStaticHandler(routes as RouteObject[], routerOptions);
  const prepareAssets = createAssetPreparer<TAppProps>(new RouteAssets(manifest, modulePreload));
  const shell =
    indexHtml === undefined ? undefined : splitHtmlShell(indexHtml, 'indexHtml', outlet);

  return async (request, env, ctx) => {
    const { pathname } = new URL(request.url);

    if (
      assets !== false &&
      ['GET', 'HEAD'].includes(request.method) &&
      pathname !== '/' &&
      pathname !== '/index.html'
    ) {
      const response = await getAssetsBinding(env, assets).fetch(request);

      if (response.status !== 404) {
        if (
          (response.ok || response.status === 304) &&
          /\/assets\/[^/]+-[\w-]{8,}\.[^/]+$/.test(pathname)
        ) {
          const headers = new Headers(response.headers);

          headers.set(CACHE_CONTROL, 'public, max-age=31536000, immutable');

          return headResponse(
            request,
            new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers,
            }),
          );
        }

        return headResponse(request, response);
      }

      await response.body?.cancel();
    }

    const executionContext: IWorkerExecutionContext<TEnv> = {
      platform: { env, ctx },
      waitUntil: ctx.waitUntil.bind(ctx) as IWorkerContext['waitUntil'],
    };
    const render = createHandler<TAppProps>(
      {
        handler,
        createApp: (children, context) =>
          createElement(App, { server: context.appProps }, children),
        renderToStream,
      },
      {
        diagnostics: false,
        ...options,
        getHtml: () =>
          getHtml ? getHtml(request, env, ctx) : { header: shell![0], footer: shell![1] },
        onRequest: onRequest ? () => onRequest({ request, executionContext }) : undefined,
        prepare: async (params) => {
          await prepareAssets(params);
          await prepare?.(params);
        },
        onShellReady: (params) => {
          const { context } = params;

          // workerd's automatic gzip can buffer a small pending shell until allReady.
          if (context.isStream && !context.response.headers.has('Content-Encoding')) {
            context.response.headers.set('Content-Encoding', 'identity');

            if (!context.response.headers.get(CACHE_CONTROL)?.includes('no-transform')) {
              context.response.headers.append(CACHE_CONTROL, 'no-transform');
            }
          }

          return onShellReady?.(params) ?? {};
        },
        onRouterReady: async (params) => ({
          isStream: !/bot|crawler|spider|slurp|bingpreview/i.test(
            request.headers.get('User-Agent') ?? '',
          ),
          ...(await onRouterReady?.(params)),
        }),
      },
    );

    return render(request, executionContext);
  };
};

export { RouteAssets };

export type { TRouteAssetsManifest, IHtmlShell };
