import type { ReactNode } from 'react';
import React from 'react';
import type { RouterState, StaticHandler, StaticHandlerContext } from 'react-router';
import { createStaticRouter, matchRoutes, StaticRouterProvider } from 'react-router';
import StreamError from '@constants/stream-error';
import { ServerProvider } from '@context/server';
import type { IServerContext } from '@context/server';
import composeHtml from '@core/compose-html';
import DataStream from '@core/data-stream';
import documentHeaders, { hasCookie } from '@core/document-headers';
import type { IDocumentHeaderRule, IDocumentHeadersOptions } from '@core/document-headers';
import headResponse from '@core/head-response';
import { mergeResponseHeaders } from '@core/headers';
import type createSpaShell from '@core/spa-shell';
import type SsrPolicy from '@core/ssr-policy';
import transformHtml from '@core/transform-html';
import type { ISsrExecutionContext } from '@core/types';
import buildCustomState from '@helpers/build-custom-state';
import buildRouterState from '@helpers/build-router-state';
import type { IObtainStreamErrorOut } from '@helpers/obtain-stream-error';
import obtainStreamError from '@helpers/obtain-stream-error';
import type Diagnostics from '@services/diagnostics';
import type RequestTimeline from '@services/request-timeline';
import { createTimeline } from '@services/request-timeline';

export interface ISsrRequestContext<TAppProps = Record<string, any>> {
  appProps: NonNullable<TAppProps>;
  diagnostics?: Diagnostics;
  timeline?: RequestTimeline;
  executionContext?: ISsrExecutionContext;

  /**
   * First render failure, or the explicit timeout/cancellation classification.
   */
  didError?: StreamError;
  html: { footer: string; header: string };
  isStream?: boolean;
  isSpa?: boolean;

  /** Structural route matches are available to prepare even when loaders are skipped. */
  matches?: RouterState['matches'];
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
  policy?: SsrPolicy;
  spaShell?: ReturnType<typeof createSpaShell>;
}

export interface ICoreRenderOptions<
  TAppProps = Record<string, any>,
> extends IDocumentHeadersOptions {
  /** Opt in to document policies after onShellReady; redirects keep their header contract. */
  documentHeaders?: readonly IDocumentHeaderRule[];

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
  {
    getState,
    onShellReady,
    hydration,
    nonce,
    documentHeaders: rules,
    sessionCookie,
    protectPrivate,
  }: ICoreRenderOptions<TAppProps>,
  dataStream?: DataStream,
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
    header += customState + dataStream!.state(true);
  } else {
    const state = dataStream
      ? dataStream.state(false) + dataStream.take()
      : buildRouterState(context.routerContext!, undefined, nonce);

    footer = customState + state + footer;
  }

  if (rules) {
    context.response.headers = documentHeaders(rules, { sessionCookie, protectPrivate })(context);
  }

  const headers = new Headers(context.response.headers);

  return { header, footer, headers, status: context.response.status };
};

/**
 * Coordinate router queries, React rendering and the final Fetch response.
 */
const renderResponse = async <TAppProps,>(
  { createApp, handler, renderToStream, policy, spaShell }: ICoreRenderParams<TAppProps>,
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
    documentHeaders: rules,
    sessionCookie,
    protectPrivate,
  }: ICoreRenderOptions<TAppProps>,
  executionContext?: ISsrExecutionContext,
): Promise<Response> => {
  const mode = policy?.select(context.request, context.diagnostics) ?? 'ssr';

  if (policy?.active && !context.response.headers.has('Cache-Control')) {
    context.response.headers.set('Cache-Control', 'no-store');
  }

  if (mode === 'spa') {
    context.isSpa = true;
    context.isStream = false;
    context.matches =
      matchRoutes(handler.dataRoutes, new URL(context.request.url), policy?.basename) ?? [];
    context.html = spaShell!(context.html);

    if (prepare) {
      await prepare({ context, executionContext });
    }

    // Document policies apply to SPA shells too; the no-store default above is their baseline.
    if (rules) {
      context.response.headers = documentHeaders(rules, { sessionCookie, protectPrivate })(context);
    }

    context.response.status = 200;
    context.response.headers.set(CONTENT_TYPE, 'text/html; charset=utf-8');

    return new Response(
      context.request.method === 'HEAD' ? null : context.html.header + context.html.footer,
      { headers: context.response.headers, status: 200 },
    );
  }

  const queried = await handler.query(context.request, {
    requestContext: routerRequestContext ?? context,
  });

  context.timeline?.record('router.query');

  if (queried instanceof Response) {
    return headResponse(context.request, mergeResponseHeaders(queried, context.response.headers));
  }

  context.routerContext = queried;
  context.matches = queried.matches;
  const { loaderData, actionData, errors } = queried;
  const hasRouterData =
    Object.keys(loaderData).length > 0 || actionData !== null || errors !== null;
  const dataStream =
    hydration === 'early' || hasRouterData
      ? new DataStream(queried, context.diagnostics, nonce, context.timeline)
      : undefined;

  try {
    if (prepare) {
      await prepare({ context, executionContext });
    }

    context.timeline?.record('prepare');
  } catch (error) {
    dataStream?.cancel();
    throw error;
  }

  const { isStream = true } = (onRouterReady ? await onRouterReady({ context }) : undefined) ?? {};

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
    context.timeline?.abort(reason);
    cleanup();
    context.didError ??= StreamError.RenderCancel;
    dataStream?.abort();
    renderController.abort(reason);
    output?.abort(reason);
  };

  /**
   * Apply the render deadline after routing and preparation finish.
   */
  const abortTimer = setTimeout(() => {
    context.didError = StreamError.RenderTimeout;
    context.timeline?.abort(new Error(`SSR render timed out after ${abortDelay}ms`));
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

    void Promise.all([output.allReady, dataStream?.done]).then(clearAbortTimer, clearAbortTimer);

    await output.shellReady;
    context.timeline?.record('shell.ready');

    if (!isStream) {
      await Promise.all([output.allReady, dataStream?.done]);
    }
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
        documentHeaders: rules,
        sessionCookie,
        protectPrivate,
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

    const body = composeHtml(
      header,
      output.stream,
      footer,
      abort,
      cleanup,
      dataStream,
      context.timeline,
      hydration === 'early' && isStream,
    );
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

/** Record the timeline and inspect the committed metadata, including redirect and shell-error responses, for every core consumer. */
const render = async <TAppProps,>(
  params: ICoreRenderParams<TAppProps>,
  context: ISsrRequestContext<TAppProps>,
  options: ICoreRenderOptions<TAppProps>,
  executionContext?: ISsrExecutionContext,
): Promise<Response> => {
  const timeline =
    context.timeline ?? createTimeline(context.request, Boolean(context.diagnostics));

  if (timeline) {
    context.timeline = timeline;
  }

  try {
    const response = await renderResponse(params, context, options, executionContext);
    const { sessionCookie } = options;

    context.diagnostics?.inspectCachePolicy(
      response.headers,
      Boolean(sessionCookie && hasCookie(context.request, sessionCookie)),
    );

    return timeline?.response(response) ?? response;
  } catch (error) {
    timeline?.abort(error);
    timeline?.end();
    throw error;
  }
};

export default render;
