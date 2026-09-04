import type { ReactNode } from 'react';
import React from 'react';
import type { StaticHandler, StaticHandlerContext } from 'react-router';
import { createStaticRouter, StaticRouterProvider } from 'react-router';
import StreamError from '@constants/stream-error';
import { ServerProvider } from '@context/server';
import type { IServerContext } from '@context/server';
import composeHtml from '@core/compose-html';
import headResponse from '@core/head-response';
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
  Boolean(
    response && response.status >= 300 && response.status < 400 && response.headers.has('Location'),
  );

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
    return headResponse(context.request, queried);
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
  const renderController = new AbortController();
  let abortReason: unknown;
  // Assigned after abort is defined so an async renderer can be cancelled while it initializes.
  let output: IRenderStream | undefined;
  let hasAborted = false;
  const onRequestAbort = (): void => abort(context.request.signal.reason);
  const cleanup = (): void => {
    clearTimeout(abortTimer);
    context.request.signal.removeEventListener('abort', onRequestAbort);
  };
  const abort = (reason?: unknown): void => {
    if (hasAborted) {
      return;
    }

    hasAborted = true;
    abortReason = reason;
    cleanup();
    context.didError ??= StreamError.RenderCancel;
    renderController.abort(reason);
    output?.abort(reason);
  };

  const abortTimer = setTimeout(() => {
    context.didError = StreamError.RenderTimeout;
    abort();
  }, abortDelay);

  if (context.request.signal.aborted) {
    abort(context.request.signal.reason);
  } else {
    context.request.signal.addEventListener('abort', onRequestAbort, { once: true });
  }

  try {
    output = await renderToStream(node, {
      onError: (error) => {
        const streamError = obtainStreamError(error);
        const { code } = streamError;

        context.didError ??= code;
        onError?.({ context, error: streamError });
      },
      signal: renderController.signal,
    });

    if (hasAborted) {
      output.abort(abortReason);
    }

    void output.allReady.then(
      () => clearTimeout(abortTimer),
      () => clearTimeout(abortTimer),
    );

    await (isStream ? output.shellReady : output.allReady);
  } catch (error) {
    abort(error);
    await output?.stream.cancel(error).catch(() => undefined);

    const shellError = error instanceof Error ? error : new Error(String(error));
    const html =
      onShellError?.({ context, error: shellError }) ||
      '<!doctype html><p>Internal Server Error</p>';
    const headers = new Headers(context.response.headers);

    headers.set(CONTENT_TYPE, HTML_CONTENT_TYPE);

    return new Response(context.request.method === 'HEAD' ? null : html, {
      headers,
      status: 500,
    });
  }

  try {
    const serverResponse = context.serverContext.response;

    if (serverResponse && isRedirect(serverResponse)) {
      abort();
      await output.stream.cancel().catch(() => undefined);

      return headResponse(context.request, serverResponse);
    }

    context.response.status =
      serverResponse?.status ?? context.response.status ?? context.routerContext.statusCode ?? 200;

    if (!context.response.headers.has(CONTENT_TYPE)) {
      context.response.headers.set(CONTENT_TYPE, HTML_CONTENT_TYPE);
    }

    const shell = onShellReady?.({ context }) ?? {};
    const routerState = buildRouterState(context.routerContext);
    const customState = buildCustomState(getState?.({ context }));
    const header = shell.header || context.html.header;
    const footer = routerState + customState + (shell.footer || context.html.footer);
    const headers = new Headers(context.response.headers);

    if (context.request.method === 'HEAD' || [204, 205, 304].includes(context.response.status)) {
      abort();
      await output.stream.cancel().catch(() => undefined);

      return new Response(null, {
        headers,
        status: context.response.status,
      });
    }

    const body = composeHtml(header, output.stream, footer, abort, cleanup);
    const transformed = transformHtml(
      body,
      onResponse ? (html) => onResponse({ context, html }) : undefined,
    );

    output.start();

    return new Response(transformed, {
      headers,
      status: context.response.status,
    });
  } catch (error) {
    abort(error);

    if (!output.stream.locked) {
      await output.stream.cancel(error).catch(() => undefined);
    }

    throw error;
  }
};

export default render;
