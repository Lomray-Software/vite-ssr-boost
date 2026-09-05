import type { Server } from 'node:net';
import type { CompressionOptions } from 'compression';
import type { Express, Request, Response as ExpressResponse } from 'express';
import type { FC, PropsWithChildren } from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler } from 'react-router';
import type { ServeStaticOptions } from 'serve-static';
import type { Logger } from 'vite';
import type { IRenderOptions, IRenderParams, TRender } from '@adapters/express/render';
import render from '@adapters/express/render';
import type { TRouteObject } from '@interfaces/route-object';
import type ServerApi from '@services/server-api';
import type ServerConfig from '@services/server-config';

export interface IInitServerRequestOut<T = Record<string, any>> {
  appProps?: T;
  hasEarlyHints?: boolean;
  shouldSkip?: boolean;
  shouldCancel?: boolean;
}

export interface IEntrypointOptions<TAppProps = Record<string, any>> extends Pick<
  IRenderOptions<TAppProps>,
  | 'onRouterReady'
  | 'onShellReady'
  | 'onShellError'
  | 'onResponse'
  | 'onError'
  | 'getState'
  | 'getBody'
> {
  onServerCreated?: (app: Express, serverApi: ServerApi) => Promise<void> | void;
  onServerStarted?: (app: Express, serverApi: ServerApi, server: Server) => Promise<void> | void;
  onRequest?: (
    req: Request,
    res: ExpressResponse,
  ) => Promise<IInitServerRequestOut<TAppProps>> | IInitServerRequestOut<TAppProps>;
}

export interface IPrepareRenderOut<TAppProps = Record<string, any>> {
  render: TRender;
  init: IEntryServerOptions<TAppProps>['init'];
  routes: TRouteObject[];
  abortDelay?: number;
  loggerProd?: Logger;
  loggerDev?: Logger;
  middlewares?: {
    compression?: CompressionOptions | false;

    /**
     * basename should be same as vite 'base' config
     */
    expressStatic?: (ServeStaticOptions & { basename?: string }) | false;
  };
}

export interface IAppServerProps<T = Record<string, any>> {
  server: T;
}

export type TApp<T> = FC<PropsWithChildren<Record<string, any> & IAppServerProps<T>>>;

export interface IEntryServerOptions<TAppProps = Record<string, any>> extends Pick<
  IPrepareRenderOut,
  'loggerProd' | 'loggerDev' | 'middlewares'
> {
  abortDelay?: number;
  init?: (params: {
    config: ServerConfig;
  }) => IEntrypointOptions<TAppProps> | Promise<IEntrypointOptions<TAppProps>>;
  routerOptions?: Parameters<typeof createStaticHandler>[1];
}

/**
 * Render server side application
 */
function entry<TAppProps>(
  App: TApp<TAppProps>,
  routes: TRouteObject[],
  { init, routerOptions, ...rest }: IEntryServerOptions<TAppProps> = {},
): IPrepareRenderOut<TAppProps> {
  const handler = createStaticHandler(routes as RouteObject[], routerOptions);

  return {
    render: render.bind(null, { handler, App } as IRenderParams<TAppProps>) as TRender,
    init,
    routes,
    ...rest,
  };
}

export default entry;
