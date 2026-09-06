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

type TWorkerHandlerOptions<TEnv = Record<string, unknown>, TAppProps = Record<string, any>> = Omit<
  ICreateHandlerOptions<TAppProps>,
  'getHtml' | 'onRequest'
> &
  TWorkerHtml<TEnv> & {
    routes: TRouteObject[];
    App: FC<PropsWithChildren<{ server: TAppProps }>>;
    manifest: TRouteAssetsManifest;

    /** Assets binding name, or false to delegate static delivery elsewhere. Default: ASSETS. */
    assets?: string | false;

    /** Emit module preload hints when enabled; defaults to false. */
    modulePreload?: boolean;

    /** HTML insertion marker; defaults to <!--ssr-outlet-->. */
    outlet?: string;
    routerOptions?: Parameters<typeof createStaticHandler>[1];
    onRequest?: (params: {
      request: Request;
      executionContext: IWorkerExecutionContext<TEnv>;
    }) => ReturnType<NonNullable<ICreateHandlerOptions<TAppProps>['onRequest']>>;
  };

/**
 * Share the cache policy field name across static and streamed responses.
 */
const CACHE_CONTROL = 'Cache-Control';

/**
 * Reuse HTML loads within a binding without retaining expired bindings.
 */
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
    /**
     * Fetch the source document and retain its reusable shell factory.
     */
    pending = (async () => {
      const response = await binding.fetch(new Request(new URL(indexPath, 'https://assets.local')));
      const { ok: isOk, body, status } = response;

      if (!isOk) {
        await body?.cancel();
        throw new Error(`[ssr-boost] Failed to load "${indexPath}" from assets: ${status}.`);
      }

      const [header, footer] = splitHtmlShell(await response.text(), indexPath, outlet);

      /**
       * Isolate mutable shell values for each request.
       */
      return () => ({ header, footer });
    })();
    cache.set(key, pending);

    /**
     * Allow a later request to retry a failed asset load.
     */
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
  routerOptions,
  onRequest,
  onRouterReady,
  onShellReady,
  prepare,
  assets = 'ASSETS',
  modulePreload = false,
  outlet = '<!--ssr-outlet-->',
  ...options
}: TWorkerHandlerOptions<TEnv, TAppProps>): TWorkerHandler<TEnv> => {
  const handler = createStaticHandler(routes as RouteObject[], routerOptions);
  const prepareAssets = createAssetPreparer<TAppProps>(new RouteAssets(manifest, modulePreload));
  const shell =
    indexHtml === undefined ? undefined : splitHtmlShell(indexHtml, 'indexHtml', outlet);

  /**
   * Serve static assets or render the matched application request.
   */
  return async (request, env, ctx) => {
    const { url, method, headers: requestHeaders } = request;
    const { pathname } = new URL(url);

    if (
      assets !== false &&
      ['GET', 'HEAD'].includes(method) &&
      pathname !== '/' &&
      pathname !== '/index.html'
    ) {
      const response = await getAssetsBinding(env, assets).fetch(request);
      const { status, ok: isOk, headers: responseHeaders, body, statusText } = response;

      if (status !== 404) {
        if ((isOk || status === 304) && /\/assets\/[^/]+-[\w-]{8,}\.[^/]+$/.test(pathname)) {
          const headers = new Headers(responseHeaders);

          headers.set(CACHE_CONTROL, 'public, max-age=31536000, immutable');

          return headResponse(
            request,
            new Response(body, {
              status,
              statusText,
              headers,
            }),
          );
        }

        return headResponse(request, response);
      }

      await body?.cancel();
    }

    const executionContext: IWorkerExecutionContext<TEnv> = {
      platform: { env, ctx },
      waitUntil: ctx.waitUntil.bind(ctx) as IWorkerContext['waitUntil'],
    };
    const render = createHandler<TAppProps>(
      {
        handler,

        /**
         * Supply request props to the application's server wrapper.
         */
        createApp: (children, context) =>
          createElement(App, { server: context.appProps }, children),
        renderToStream,
      },
      {
        diagnostics: false,
        ...options,

        /**
         * Resolve a request shell from the configured source.
         */
        getHtml: () =>
          getHtml ? getHtml(request, env, ctx) : { header: shell![0], footer: shell![1] },

        /**
         * Expose Worker bindings and lifetime hooks to request initialization.
         */
        onRequest: onRequest ? () => onRequest({ request, executionContext }) : undefined,

        /**
         * Inject route assets before running application preparation.
         */
        prepare: async (params) => {
          await prepareAssets(params);
          await prepare?.(params);
        },

        /**
         * Keep the pending shell flushable before applying the application hook.
         */
        onShellReady: (params) => {
          const { context } = params;
          const { isStream, response } = context;
          const { headers } = response;

          // workerd's automatic gzip can buffer a small pending shell until allReady.
          if (isStream && !headers.has('Content-Encoding')) {
            headers.set('Content-Encoding', 'identity');

            if (!headers.get(CACHE_CONTROL)?.includes('no-transform')) {
              headers.append(CACHE_CONTROL, 'no-transform');
            }
          }

          return onShellReady?.(params) ?? {};
        },

        /**
         * Default crawlers to buffered rendering while allowing an application override.
         */
        onRouterReady: async (params) => ({
          isStream: !/bot|crawler|spider|slurp|bingpreview/i.test(
            requestHeaders.get('User-Agent') ?? '',
          ),
          ...(await onRouterReady?.(params)),
        }),
      },
    );

    return render(request, executionContext);
  };
};

export { RouteAssets };

export type { TWorkerHandlerOptions as IWorkerHandlerOptions, TRouteAssetsManifest, IHtmlShell };
