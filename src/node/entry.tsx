import type { Server } from 'node:net';
import type { CompressionOptions } from 'compression';
import type { Express, Request, Response as ExpressResponse } from 'express';
import type { FC, PropsWithChildren } from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler } from 'react-router';
import type { ServeStaticOptions } from 'serve-static';
import type { Logger } from 'vite';
import type { TRouteObject } from '@interfaces/route-object';
import type { IRenderOptions, IRenderParams, TRender } from '@node/render';
import render from '@node/render';
import type ServerApi from '@services/server-api';
import type ServerConfig from '@services/server-config';

export interface IInitServerRequestOut<T = Record<string, any>> {
  appProps?: T;
  hasEarlyHints?: boolean;
  shouldSkip?: boolean;
}

export interface IEntrypointOptions<TAppProps = Record<string, any>> {
  onServerCreated?: (app: Express, serverApi: ServerApi) => Promise<void> | void;
  onServerStarted?: (app: Express, serverApi: ServerApi, server: Server) => Promise<void> | void;
  onRequest?: (
    req: Request,
    res: ExpressResponse,
  ) => Promise<IInitServerRequestOut<TAppProps>> | IInitServerRequestOut<TAppProps>;
  onRouterReady?: IRenderOptions<TAppProps>['onRouterReady'];
  onShellReady?: IRenderOptions<TAppProps>['onShellReady'];
  onShellError?: IRenderOptions<TAppProps>['onShellError'];
  onResponse?: IRenderOptions<TAppProps>['onResponse'];
  onError?: IRenderOptions<TAppProps>['onError'];
  getState?: IRenderOptions<TAppProps>['getState'];
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
    // basename should be same as vite 'base' config
    expressStatic?: (ServeStaticOptions & { basename?: string }) | false;
  };
}

export interface IAppServerProps<T = Record<string, any>> {
  server: T;
}

export type TApp<T> = FC<PropsWithChildren<Record<string, any> & IAppServerProps<T>>>;

export interface IEntryServerOptions<TAppProps = Record<string, any>> {
  abortDelay?: number;
  init?: (params: {
    config: ServerConfig;
  }) => IEntrypointOptions<TAppProps> | Promise<IEntrypointOptions<TAppProps>>;
  loggerProd?: IPrepareRenderOut['loggerProd'];
  loggerDev?: IPrepareRenderOut['loggerDev'];
  middlewares?: IPrepareRenderOut['middlewares'];
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
