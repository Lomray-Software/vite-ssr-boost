import chalk from 'chalk';
import type { Request, Response as ExpressResponse } from 'express';
import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import type { StaticHandlerContext, StaticHandler } from 'react-router';
import { createStaticRouter, StaticRouterProvider } from 'react-router';
import StreamError from '@constants/stream-error';
import type { IServerContext } from '@context/server';
import { ServerProvider } from '@context/server';
import handleResponse from '@helpers/handle-response';
import type { IObtainStreamErrorOut } from '@helpers/obtain-stream-error';
import obtainStreamError from '@helpers/obtain-stream-error';
import createFetchRequest from '@node/create-fetch-request';
import type { TApp } from '@node/entry';
import writeResponse from '@node/write-response';
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
  const { req, res } = context;
  const fetchRequest = createFetchRequest(req);

  context.routerContext = (await handler.query(fetchRequest, {
    requestContext: context,
  })) as StaticHandlerContext;

  /**
   * Handle response from page loader, router context can be Response
   */
  const statusCode = handleResponse(res, context.routerContext);

  if (!statusCode) {
    return;
  }

  SsrManifest.get(config).injectAssets(context);

  const { isStream = true } = (await onRouterReady?.({ context })) ?? {};

  context.isStream = isStream;
  context.serverContext = {
    response: null,
    isServer: true,
    basename: context.routerContext?.basename,
  };

  const router = createStaticRouter(handler.dataRoutes, context.routerContext);
  const write = res.write.bind(res) as ExpressResponse['write'];
  const Logger = config.getLogger();
  let abortTimer: NodeJS.Timer | undefined = undefined;

  /**
   * Listen response and stream to add possibility modify html on fly
   * E.g. listen stream and append some data
   */
  res.write = (data: string | Uint8Array, ...args): boolean => {
    const isString = typeof data === 'string';
    const html = isString ? data : Buffer.from(data).toString();
    const modifiedHtml = onResponse?.({ context, html });

    if (modifiedHtml) {
      // @ts-ignore
      return write(isString ? modifiedHtml : Buffer.from(modifiedHtml), ...args) as boolean;
    }

    // @ts-ignore
    return write(data, ...args) as boolean;
  };

  const { serverContext, routerContext, appProps } = context;

  const { pipe, abort } = renderToPipeableStream(
    <ServerProvider context={serverContext}>
      <App server={{ ...appProps, req }}>
        <StaticRouterProvider router={router} context={routerContext} hydrate={false} />
      </App>
    </ServerProvider>,
    {
      onShellReady(): void {
        if (!isStream) {
          return;
        }

        writeResponse(context, {
          pipe,
          statusCode,
          onShellReady,
          getState,
        });
      },
      onAllReady(): void {
        clearTimeout(abortTimer);

        if (isStream) {
          return;
        }

        writeResponse(context, {
          pipe,
          statusCode,
          onShellReady,
          getState,
        });
      },
      onShellError(e: Error): void {
        const htmlError =
          onShellError?.({ context, error: e }) ||
          `<!doctype html><p>Something went wrong: ${e.message}</p>`;

        res.status(500);
        res.setHeader('content-type', 'text/html');
        res.send(htmlError);
      },
      onError(err): void {
        clearTimeout(abortTimer);

        const error = obtainStreamError(err);
        const { code, message } = error;
        const { didError } = context;

        context.didError = didError ?? code;

        onError?.({ context, error });
        Logger.info(chalk.red(`Stream error. Code: ${code}`));

        if (
          [StreamError.RenderAborted, StreamError.RenderTimeout, StreamError.RenderCancel].includes(
            code,
          )
        ) {
          Logger.info(chalk.dim(message));

          return;
        }

        Logger.error(err as string);
      },
    },
  );

  // Abandon and switch to client rendering if enough time passes.
  abortTimer = setTimeout(() => {
    context.didError = StreamError.RenderTimeout;
    abort();
  }, abortDelay);

  // Detect cancel request
  req.on('close', () => {
    context.didError = StreamError.RenderCancel;
    abort();
  });
}

export default render;
