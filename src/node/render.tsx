import chalk from 'chalk';
import type { Request, Response as ExpressResponse } from 'express';
import React from 'react';
import type { StaticHandlerContext, StaticHandler } from 'react-router';
import StreamError from '@constants/stream-error';
import type { IServerContext } from '@context/server';
import coreRender from '@core/render';
import type { ISsrRequestContext } from '@core/render';
import type { IObtainStreamErrorOut } from '@helpers/obtain-stream-error';
import createFetchRequest from '@node/create-fetch-request';
import type { TApp } from '@node/entry';
import renderToStream from '@node/render-to-stream';
import writeFetchResponse from '@node/write-fetch-response';
import type ServerConfig from '@services/server-config';
import SsrManifest from '@services/ssr-manifest';

export interface IRequestContext<TAppProps = Record<any, any>> {
  req: Request;
  res: ExpressResponse;
  appProps: NonNullable<TAppProps>;
  html: { header: string; footer: string };
  routerContext?: StaticHandlerContext;
  serverContext?: IServerContext;
  isStream?: boolean;
  hasEarlyHints?: boolean;
  didError?: StreamError;
}

export type TRender<TAppProps = Record<any, any>> = (
  config: ServerConfig,
  context: IRequestContext<TAppProps>,
  options: IRenderOptions,
) => Promise<void>;

export interface IRenderParams<TAppProps = Record<string, any>> {
  App: TApp<TAppProps>;
  handler: StaticHandler;
}

export interface IRenderOptions<TAppProps = Record<string, any>> {
  abortDelay?: number;
  onRouterReady?: (params: {
    context: IRequestContext<TAppProps>;
  }) => Promise<IRouterReadyOut> | IRouterReadyOut;
  onShellReady?: (params: { context: IRequestContext<TAppProps> }) => IShellReadyOut;
  onShellError?: (params: {
    context: IRequestContext<TAppProps>;
    error: Error;
  }) => string | undefined | void; // return html or undefined
  onError?: (params: { context: IRequestContext<TAppProps>; error: IObtainStreamErrorOut }) => void;
  onResponse?: (params: {
    context: IRequestContext<TAppProps>;
    html: string;
  }) => string | undefined | void;
  getState?: (params: {
    context: IRequestContext<TAppProps>;
  }) => Record<string, Record<string, any>> | undefined | void;
}

export interface IRouterReadyOut {
  isStream?: boolean;
}

export interface IShellReadyOut {
  header?: string;
  footer?: string;
}

/**
 * Render application
 */
async function render(
  { App, handler }: IRenderParams, // @see entry (bind)
  config: ServerConfig,
  context: IRequestContext,
  {
    onRouterReady,
    onShellReady,
    onResponse,
    onShellError,
    onError,
    getState,
    abortDelay = 15000,
  }: IRenderOptions,
): Promise<void> {
  const { appProps, html: shellHtml, req, res } = context;
  const Logger = config.getLogger();
  const coreContext: ISsrRequestContext = {
    appProps,
    html: shellHtml,
    request: createFetchRequest(req),
    response: {
      headers: new Headers(),
    },
  };
  const syncContext = (updated: ISsrRequestContext): IRequestContext => {
    context.didError = updated.didError;
    context.html = updated.html;
    context.isStream = updated.isStream;
    context.routerContext = updated.routerContext;
    context.serverContext = updated.serverContext;

    return context;
  };
  const response = await coreRender(
    {
      createApp: (children, updated) => <App server={{ ...updated.appProps, req }}>{children}</App>,
      handler,
      renderToStream,
    },
    coreContext,
    {
      abortDelay,
      getState: getState
        ? ({ context: updated }) => getState({ context: syncContext(updated) })
        : undefined,
      onError: ({ context: updated, error }) => {
        const { code, message } = error;

        onError?.({ context: syncContext(updated), error });
        Logger.info(chalk.red(`Stream error. Code: ${code}`));

        if (
          [StreamError.RenderAborted, StreamError.RenderTimeout, StreamError.RenderCancel].includes(
            code,
          )
        ) {
          Logger.info(chalk.dim(message));

          return;
        }

        const { original } = error;

        Logger.error(original as string);
      },
      onResponse: onResponse
        ? ({ context: updated, html }) => onResponse({ context: syncContext(updated), html })
        : undefined,
      onRouterReady: onRouterReady
        ? ({ context: updated }) => onRouterReady({ context: syncContext(updated) })
        : undefined,
      onShellError: onShellError
        ? ({ context: updated, error }) => onShellError({ context: syncContext(updated), error })
        : undefined,
      onShellReady: onShellReady
        ? ({ context: updated }) => onShellReady({ context: syncContext(updated) })
        : undefined,
      prepare: ({ context: updated }) => {
        SsrManifest.get(config).injectAssets(syncContext(updated));
      },
      routerRequestContext: context,
    },
  );

  syncContext(coreContext);

  const location = response.headers.get('Location');

  if (location && response.status >= 300 && response.status < 400) {
    res.redirect(response.status, location);

    return;
  }

  await writeFetchResponse(res, response);
}

export default render;
