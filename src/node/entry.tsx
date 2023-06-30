import type { Express, Request, Response as ExpressResponse } from 'express';
import type { FC, PropsWithChildren } from 'react';
import type { RouteObject } from 'react-router-dom';
import { createStaticHandler } from 'react-router-dom/server.mjs';
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
  initServer: IEntryServerOptions<TAppProps>['initServer'];
}

export interface IAppServerProps<T = Record<string, any>> {
  server: T & {
    req: Request;
  };
}

export type TApp<T> = FC<PropsWithChildren<IAppServerProps<T>>>;

export interface IEntryServerOptions<TAppProps = Record<string, any>> {
  routes: RouteObject[];
  initServer?: (params: {
    config: ServerConfig;
  }) => IEntrypointOptions<TAppProps> | Promise<IEntrypointOptions<TAppProps>>;
}

/**
 * Render server side application
 */
function entry<TAppProps>(
  { routes, initServer }: IEntryServerOptions<TAppProps>,
  App: TApp<TAppProps>,
): IPrepareRenderOut<TAppProps> {
  const handler = createStaticHandler(routes);

  return {
    render: render.bind(null, { handler, App } as IRenderParams<TAppProps>) as TRender,
    initServer,
  };
}

export default entry;
