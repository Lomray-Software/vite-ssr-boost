import type { ReactNode } from 'react';
import React from 'react';
import type { StaticHandler, StaticHandlerContext } from 'react-router';
import { createStaticRouter, StaticRouterProvider } from 'react-router';
import StreamError from '@constants/stream-error';
import { ServerProvider } from '@context/server';
import type { IServerContext } from '@context/server';
import composeHtml from '@core/compose-html';
import DataStream from '@core/data-stream';
import headResponse from '@core/head-response';
import { mergeResponseHeaders } from '@core/headers';
import transformHtml from '@core/transform-html';
import type { ISsrExecutionContext } from '@core/types';
import buildCustomState from '@helpers/build-custom-state';
import type { IObtainStreamErrorOut } from '@helpers/obtain-stream-error';
import obtainStreamError from '@helpers/obtain-stream-error';
import type Diagnostics from '@services/diagnostics';

export interface ISsrRequestContext<TAppProps = Record<string, any>> {
  appProps: NonNullable<TAppProps>;
  diagnostics?: Diagnostics;

  /**
   * First render failure, or the explicit timeout/cancellation classification.
   */
  didError?: StreamError;
  html: { footer: string; header: string };
  isStream?: boolean;
  request: Request;

  /**
   * Mutable response metadata shared with request and render hooks.
   */
  response: {
    headers: Headers;
    status?: number;
  };
  routerContext?: StaticHandlerContext;
  serverContext?: IServerContext;
}

export interface IRenderStreamOptions {
  nonce?: string;
  bootstrapScriptContent?: string;
  onError: (error: unknown) => void;
  signal: AbortSignal;
}

export interface IRenderStream {
  /**
   * Settles after all suspended content completes or rendering is aborted.
   */
  allReady: Promise<void>;

  /**
   * Stop rendering and settle pending readiness promises.
   */
  abort: (reason?: unknown) => void;

  /**
   * Settles when the first shell is available or cannot be produced.
   */
  shellReady: Promise<void>;

  /**
   * Begin piping after the core commits its response metadata.
   */
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
  /** Hydrate the parsed shell while deferred boundaries are still pending. */
  hydration?: 'early' | 'footer';
  nonce?: string;
  bootstrapScriptContent?: string;
  /**
   * React rendering deadline in milliseconds, starting after router preparation.
   */
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
    isEnd: boolean;
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

interface IHtmlResponse {
  header: string;
  footer: string;
  headers: Headers;
  status: number;
}

const HTML_CONTENT_TYPE = 'text/html';
const CONTENT_TYPE = 'Content-Type';

/**
 * Distinguish navigational redirects from bodyless statuses such as 304.
 */
const isRedirect = (response?: Response | null): boolean =>
  Boolean(
    response && response.status >= 300 && response.status < 400 && response.headers.has('Location'),
  );

/**
 * Build a bodyless HEAD or generic 500 response when React cannot produce a shell.
 */
const createShellErrorResponse = <TAppProps,>(
  context: ISsrRequestContext<TAppProps>,
  error: unknown,
  onShellError: ICoreRenderOptions<TAppProps>['onShellError'],
): Response => {
  const shellError = error instanceof Error ? error : new Error(String(error));
  const html =
    onShellError?.({ context, error: shellError }) || '<!doctype html><p>Internal Server Error</p>';
  const headers = new Headers(context.response.headers);

  headers.set(CONTENT_TYPE, HTML_CONTENT_TYPE);

  return new Response(context.request.method === 'HEAD' ? null : html, {
    headers,
    status: 500,
  });
};

/**
 * Prepare the document shell and let hooks finalize response metadata synchronously.
 */
const prepareHtmlResponse = <TAppProps,>(
  context: ISsrRequestContext<TAppProps>,
  { getState, onShellReady, hydration, nonce }: ICoreRenderOptions<TAppProps>,
  dataStream: DataStream,
): IHtmlResponse => {
  const serverResponse = context.serverContext!.response;

  context.response.status =
    serverResponse?.status ?? context.response.status ?? context.routerContext!.statusCode ?? 200;

  if (!context.response.headers.has(CONTENT_TYPE)) {
    context.response.headers.set(CONTENT_TYPE, HTML_CONTENT_TYPE);
  }

  const shell = onShellReady?.({ context }) ?? {};
  const isEarly = hydration === 'early' && context.isStream;
  const customState = buildCustomState(
    getState?.({ context }),
    context.diagnostics,
    nonce,
    Boolean(isEarly),
  );
  let header = shell.header || context.html.header;
  const shellFooter = shell.footer || context.html.footer;

  context.diagnostics?.inspectShell({ header, footer: shellFooter });

  // Router state unblocks the browser entry, so custom state must already be available.
  let footer = shellFooter;

  if (isEarly) {
    header += customState + dataStream.state(true);
  } else {
    footer = customState + dataStream.state(false) + dataStream.take() + footer;
  }

  const headers = new Headers(context.response.headers);

  return { header, footer, headers, status: context.response.status };
};

/**
 * Coordinate router queries, React rendering and the final Fetch response.
 */
const render = async <TAppProps,>(
  { createApp, handler, renderToStream }: ICoreRenderParams<TAppProps>,
  context: ISsrRequestContext<TAppProps>,
  {
    abortDelay = 15_000,
    getState,
    hydration = 'footer',
    nonce,
    bootstrapScriptContent,
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
    return headResponse(context.request, mergeResponseHeaders(queried, context.response.headers));
  }

  context.routerContext = queried;
  const dataStream = new DataStream(queried, context.diagnostics, nonce);

  try {
    await prepare?.({ context, executionContext });
  } catch (error) {
    dataStream.cancel();
    throw error;
  }

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

  /**
   * Assigned after abort is defined so an async renderer can be cancelled while it initializes.
   */
  let output: IRenderStream | undefined;
  let hasAborted = false;

  /**
   * Propagate the request cancellation reason into the renderer.
   */
  const onRequestAbort = (): void => abort(context.request.signal.reason);

  /**
   * Clear the deadline when React finishes or the response is cancelled.
   */
  const clearAbortTimer = (): void => clearTimeout(abortTimer);

  /**
   * Release the render deadline and request disconnect listener.
   */
  const cleanup = (): void => {
    clearAbortTimer();
    context.request.signal.removeEventListener('abort', onRequestAbort);
  };

  /**
   * Cancel rendering once while preserving the reason reported by lifecycle hooks.
   */
  const abort = (reason?: unknown): void => {
    if (hasAborted) {
      return;
    }

    hasAborted = true;
    abortReason = reason;
    cleanup();
    context.didError ??= StreamError.RenderCancel;
    dataStream.abort();
    renderController.abort(reason);
    output?.abort(reason);
  };

  /**
   * Apply the render deadline after routing and preparation finish.
   */
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
      nonce,
      bootstrapScriptContent:
        hydration === 'early' && isStream
          ? `(window.__ssrBoostStream = window.__ssrBoostStream || []).push(["shell"]);${bootstrapScriptContent ?? ''};document.currentScript?.remove();`
          : bootstrapScriptContent,
      /**
       * Classify expected cancellation separately from unexpected React errors.
       */
      onError: (error) => {
        const streamError = obtainStreamError(error);

        if (
          hasAborted &&
          (streamError.code === StreamError.RenderAborted ||
            error === renderController.signal.reason)
        ) {
          streamError.code =
            context.didError === StreamError.RenderTimeout
              ? StreamError.RenderTimeout
              : StreamError.RenderCancel;
        }

        const { code } = streamError;

        context.didError ??= code;
        onError?.({ context, error: streamError });
      },
      signal: renderController.signal,
    });

    if (hasAborted) {
      output.abort(abortReason);
    }

    void Promise.all([output.allReady, dataStream.done]).then(clearAbortTimer, clearAbortTimer);

    await (isStream ? output.shellReady : Promise.all([output.allReady, dataStream.done]));
  } catch (error) {
    abort(error);
    await output?.stream.cancel(error).catch(() => undefined);

    return createShellErrorResponse(context, error, onShellError);
  }

  try {
    const serverResponse = context.serverContext.response;

    if (serverResponse && isRedirect(serverResponse)) {
      abort();
      await output.stream.cancel().catch(() => undefined);

      return headResponse(
        context.request,
        mergeResponseHeaders(serverResponse, context.response.headers),
      );
    }

    const { header, footer, headers, status } = prepareHtmlResponse(
      context,
      {
        getState,
        onShellReady,
        hydration,
        nonce,
      },
      dataStream,
    );

    if (context.request.method === 'HEAD' || [204, 205, 304].includes(status)) {
      abort();
      await output.stream.cancel().catch(() => undefined);

      return new Response(null, {
        headers,
        status,
      });
    }

    const body = composeHtml(header, output.stream, footer, abort, cleanup, dataStream);
    const transformed = transformHtml(
      body,
      onResponse ? (html, isEnd) => onResponse({ context, html, isEnd }) : undefined,
      context.diagnostics,
    );

    output.start();

    return new Response(transformed, {
      headers,
      status,
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
