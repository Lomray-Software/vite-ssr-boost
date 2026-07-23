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

export interface ISsrRequestContext<TAppProps = Record<string, any>> {
  appProps: NonNullable<TAppProps>;
  didError?: StreamError;
  html: { footer: string; header: string };
  isStream?: boolean;
  request: Request;
  routerContext?: StaticHandlerContext;
  serverContext?: IServerContext;
}

export interface IRenderStreamOptions {
  onAllReady: () => void;
  onError: (error: unknown) => void;
  onShellError: (error: Error) => void;
  onShellReady: () => void;
}

export interface IRenderStream {
  abort: (reason?: unknown) => void;
  start: () => void;
  stream: ReadableStream<Uint8Array>;
}

export type TRenderToStream = (node: ReactNode, options: IRenderStreamOptions) => IRenderStream;

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

  return new Promise<Response>((resolve) => {
    // Assigned after callbacks are created; renderers invoke them asynchronously.
    // eslint-disable-next-line prefer-const
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    let hasResolved = false;
    // eslint-disable-next-line prefer-const
    let output: IRenderStream;

    const resolveShell = (): void => {
      if (hasResolved) {
        return;
      }

      const serverResponse = context.serverContext?.response;

      if (serverResponse && isRedirect(serverResponse)) {
        hasResolved = true;
        output.abort();
        resolve(serverResponse);

        return;
      }

      const shell = onShellReady?.({ context }) ?? {};
      const routerState = buildRouterState(context.routerContext!);
      const customState = buildCustomState(getState?.({ context }));
      const header = shell.header || context.html.header;
      const footer = routerState + customState + (shell.footer || context.html.footer);
      const body = composeHtml(header, output.stream, footer);
      const transformed = transformHtml(body, (html) => onResponse?.({ context, html }));
      const headers = new Headers({ 'Content-Type': 'text/html' });

      hasResolved = true;
      output.start();
      resolve(
        new Response(transformed, {
          headers,
          status: serverResponse?.status ?? 200,
        }),
      );
    };

    output = renderToStream(node, {
      onAllReady: () => {
        clearTimeout(abortTimer);

        if (!isStream) {
          resolveShell();
        }
      },
      onError: (error) => {
        clearTimeout(abortTimer);

        const streamError = obtainStreamError(error);
        const { code } = streamError;

        context.didError ??= code;
        onError?.({ context, error: streamError });
      },
      onShellError: (error) => {
        if (hasResolved) {
          return;
        }

        clearTimeout(abortTimer);
        hasResolved = true;

        const html =
          onShellError?.({ context, error }) ||
          `<!doctype html><p>Something went wrong: ${error.message}</p>`;

        resolve(
          new Response(html, {
            headers: { 'Content-Type': 'text/html' },
            status: 500,
          }),
        );
      },
      onShellReady: () => {
        if (isStream) {
          resolveShell();
        }
      },
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
  });
};

export default render;
