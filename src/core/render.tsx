import type { ReactNode } from 'react';
import React from 'react';
import type { StaticHandler, StaticHandlerContext } from 'react-router';
import { createStaticRouter, StaticRouterProvider } from 'react-router';
import StreamError from '@constants/stream-error';
import { ServerProvider } from '@context/server';
import type { IServerContext } from '@context/server';
import composeHtml from '@core/compose-html';
import transformHtml from '@core/transform-html';
import type { ISsrExecutionContext } from '@core/types';
import buildCustomState from '@helpers/build-custom-state';
import buildRouterState from '@helpers/build-router-state';
import type { IObtainStreamErrorOut } from '@helpers/obtain-stream-error';
import obtainStreamError from '@helpers/obtain-stream-error';

const HTML_CONTENT_TYPE = 'text/html';
const CONTENT_TYPE = 'Content-Type';

export interface ISsrRequestContext<TAppProps = Record<string, any>> {
  appProps: NonNullable<TAppProps>;
  didError?: StreamError;
  html: { footer: string; header: string };
  isStream?: boolean;
  request: Request;
  response: {
    headers: Headers;
    status?: number;
  };
  routerContext?: StaticHandlerContext;
  serverContext?: IServerContext;
}

export interface IRenderStreamOptions {
  onError: (error: unknown) => void;
  signal: AbortSignal;
}

export interface IRenderStream {
  allReady: Promise<void>;
  abort: (reason?: unknown) => void;
  shellReady: Promise<void>;
  start: () => void;
  stream: ReadableStream<Uint8Array>;
}

export type TRenderToStream = (
  node: ReactNode,
  options: IRenderStreamOptions,
) => IRenderStream | Promise<IRenderStream>;

export interface ICoreRenderParams<TAppProps = Record<string, any>> {
  createApp: (children: ReactNode, context: ISsrRequestContext<TAppProps>) => ReactNode;
  handler: StaticHandler;
  renderToStream: TRenderToStream;
}

export interface ICoreRenderOptions<TAppProps = Record<string, any>> {
  abortDelay?: number;
  getState?: (params: {
    context: ISsrRequestContext<TAppProps>;
  }) => Record<string, Record<string, any>> | undefined | void;
  onError?: (params: {
    context: ISsrRequestContext<TAppProps>;
    error: IObtainStreamErrorOut;
  }) => void;
  onResponse?: (params: {
    context: ISsrRequestContext<TAppProps>;
    html: string;
  }) => string | undefined | void;
  onRouterReady?: (params: {
    context: ISsrRequestContext<TAppProps>;
  }) => Promise<{ isStream?: boolean }> | { isStream?: boolean };
  onShellError?: (params: {
    context: ISsrRequestContext<TAppProps>;
    error: Error;
  }) => string | undefined | void;
  onShellReady?: (params: { context: ISsrRequestContext<TAppProps> }) => {
    footer?: string;
    header?: string;
  };
  prepare?: (params: {
    context: ISsrRequestContext<TAppProps>;
    executionContext?: ISsrExecutionContext;
  }) => Promise<void> | void;
  routerRequestContext?: unknown;
}

const isRedirect = (response?: Response | null): boolean =>
  Boolean(response && response.status >= 300 && response.status < 400);

const render = async <TAppProps,>(
  { createApp, handler, renderToStream }: ICoreRenderParams<TAppProps>,
  context: ISsrRequestContext<TAppProps>,
  {
    abortDelay = 15_000,
    getState,
    onError,
    onResponse,
    onRouterReady,
    onShellError,
    onShellReady,
    prepare,
    routerRequestContext,
  }: ICoreRenderOptions<TAppProps>,
  executionContext?: ISsrExecutionContext,
): Promise<Response> => {
  const queried = await handler.query(context.request, {
    requestContext: routerRequestContext ?? context,
  });

  if (queried instanceof Response) {
    return queried;
  }

  context.routerContext = queried;

  await prepare?.({ context, executionContext });

  const { isStream = true } = (await onRouterReady?.({ context })) ?? {};

  context.isStream = isStream;
  context.serverContext = {
    basename: context.routerContext.basename,
    isServer: true,
    response: null,
  };

  const router = createStaticRouter(handler.dataRoutes, context.routerContext);
  const node = (
    <ServerProvider context={context.serverContext}>
      {createApp(
        <StaticRouterProvider router={router} context={context.routerContext} hydrate={false} />,
        context,
      )}
    </ServerProvider>
  );
  // Assigned after the renderer is created; its onError hook can run during creation.
  // eslint-disable-next-line prefer-const
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  const output = await renderToStream(node, {
    onError: (error) => {
      clearTimeout(abortTimer);

      const streamError = obtainStreamError(error);
      const { code } = streamError;

      context.didError ??= code;
      onError?.({ context, error: streamError });
    },
    signal: context.request.signal,
  });
  const abort = (reason?: unknown): void => {
    context.didError ??= StreamError.RenderCancel;
    output.abort(reason);
  };

  if (context.request.signal.aborted) {
    abort(context.request.signal.reason);
  } else {
    context.request.signal.addEventListener('abort', () => abort(context.request.signal.reason), {
      once: true,
    });
  }

  abortTimer = setTimeout(() => {
    context.didError = StreamError.RenderTimeout;
    output.abort();
  }, abortDelay);
  void output.allReady.then(
    () => clearTimeout(abortTimer),
    () => clearTimeout(abortTimer),
  );

  try {
    await (isStream ? output.shellReady : output.allReady);
  } catch (error) {
    clearTimeout(abortTimer);

    const shellError = error as Error;
    const html =
      onShellError?.({ context, error: shellError }) ||
      `<!doctype html><p>Something went wrong: ${shellError.message}</p>`;
    const headers = new Headers(context.response.headers);

    headers.set(CONTENT_TYPE, HTML_CONTENT_TYPE);

    return new Response(html, {
      headers,
      status: 500,
    });
  }

  const serverResponse = context.serverContext.response;

  if (serverResponse && isRedirect(serverResponse)) {
    output.abort();

    return serverResponse;
  }

  const shell = onShellReady?.({ context }) ?? {};
  const routerState = buildRouterState(context.routerContext);
  const customState = buildCustomState(getState?.({ context }));
  const header = shell.header || context.html.header;
  const footer = routerState + customState + (shell.footer || context.html.footer);
  const body = composeHtml(header, output.stream, footer);
  const transformed = transformHtml(body, (html) => onResponse?.({ context, html }));
  const headers = new Headers(context.response.headers);

  if (!headers.has(CONTENT_TYPE)) {
    headers.set(CONTENT_TYPE, HTML_CONTENT_TYPE);
  }

  output.start();

  return new Response(transformed, {
    headers,
    status: serverResponse?.status ?? context.response.status ?? 200,
  });
};

export default render;
