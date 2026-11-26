import type { FC, PropsWithChildren } from 'react';
import { createElement } from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler } from 'react-router';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions } from '@core/handler';
import HandlerRuntime from '@core/handler-runtime';
import type { TRenderToStream } from '@core/render';
import type { TSsrHandler } from '@core/types';
import type { TRouteObject } from '@interfaces/route-object';

type TPrepare<TAppProps> = NonNullable<ICreateHandlerOptions<TAppProps>['prepare']>;

/**
 * Runtime services a host supplies when it mounts an entry.
 */
interface IEntryHost<TAppProps = Record<string, any>> {
  getHtml: ICreateHandlerOptions<TAppProps>['getHtml'];
  /** Host asset preparation; runs before the entry's own prepare hook. */
  prepare?: TPrepare<TAppProps>;
  renderToStream: TRenderToStream;
}

type TEntryOptions<TAppProps = Record<string, any>> = Omit<
  ICreateHandlerOptions<TAppProps>,
  'getHtml'
> & {
  routerOptions?: Parameters<typeof createStaticHandler>[1];
};

type TEntryApp<TAppProps> = FC<PropsWithChildren<{ server: TAppProps }>>;

/**
 * A runtime-neutral entry: each host calls it once with its own services.
 */
interface IEntry<TAppProps = Record<string, any>> {
  (host: IEntryHost<TAppProps>): TSsrHandler;
  readonly kind: 'ssr-boost-entry';
}

/**
 * Mark an export as a managed entry so hosts can tell it apart from the Express entry.
 */
const isEntry = (value: unknown): value is IEntry =>
  typeof value === 'function' && (value as Partial<IEntry>).kind === 'ssr-boost-entry';

/**
 * Describe the application once and let node:http, Fastify, Hono or edge hosts mount it.
 */
const defineEntry = <TAppProps = Record<string, any>>(
  App: TEntryApp<TAppProps>,
  routes: TRouteObject[],
  { routerOptions, prepare, ...options }: TEntryOptions<TAppProps> = {},
): IEntry<TAppProps> => {
  const basename = routerOptions?.basename ?? options.basename;
  const handler = createStaticHandler(routes as RouteObject[], { ...routerOptions, basename });
  const runtime = new HandlerRuntime(handler.dataRoutes, { ...options, basename });

  /**
   * Bind host services to the shared router and runtime state.
   */
  const entry = ({ getHtml, prepare: hostPrepare, renderToStream }: IEntryHost<TAppProps>) =>
    createHandler<TAppProps>(
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
        ...options,
        basename,
        getHtml,

        /**
         * Inject host assets before the application's own preparation.
         */
        prepare:
          hostPrepare || prepare
            ? async (params) => {
                await hostPrepare?.(params);
                await prepare?.(params);
              }
            : undefined,
      },
      runtime,
    );

  return Object.assign(entry, { kind: 'ssr-boost-entry' as const });
};

export { isEntry };

export type { IEntry, IEntryHost, TEntryOptions as IEntryOptions, TEntryApp };

export default defineEntry;
