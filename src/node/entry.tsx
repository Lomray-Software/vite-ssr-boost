import type { Express, Request, Response as ExpressResponse } from 'express';
import type { FC, PropsWithChildren } from 'react';
import type { RouteObject } from 'react-router-dom';
import { createStaticHandler } from 'react-router-dom/server.mjs';
import type { TRouteObject } from '@interfaces/route-object';
import type { IRenderOptions, IRenderParams, TRender } from '@node/render';
import render from '@node/render';
import type ServerConfig from '@services/server-config';

export interface IInitServerRequestOut<T = Record<string, any>> {
  appProps?: T;
}

export interface IEntrypointOptions<TAppProps = Record<string, any>> {
  onServerCreated?: (app: Express) => Promise<void> | void;
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
}

/**
 * Render server side application
 */
function entry<TAppProps>(
  App: TApp<TAppProps>,
  routes: TRouteObject[],
  { init, abortDelay }: IEntryServerOptions<TAppProps> = {},
): IPrepareRenderOut<TAppProps> {
  const handler = createStaticHandler(routes as RouteObject[]);

  return {
    render: render.bind(null, { handler, App } as IRenderParams<TAppProps>) as TRender,
    init,
    routes,
    abortDelay,
  };
}

export default entry;
