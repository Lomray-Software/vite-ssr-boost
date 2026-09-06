import { hasCookie } from '@core/document-headers';
import headResponse from '@core/head-response';
import render from '@core/render';
import type { ICoreRenderOptions, ICoreRenderParams, ISsrRequestContext } from '@core/render';
import createSpaShell from '@core/spa-shell';
import SsrPolicy from '@core/ssr-policy';
import type { ISsrPolicy } from '@core/ssr-policy';
import type { ISsrExecutionContext, TSsrHandler } from '@core/types';
import Diagnostics, { isDiagnosticsEnabled } from '@services/diagnostics';
import { createTimeline } from '@services/request-timeline';

interface IHtmlShell {
  footer: string;
  header: string;
}

interface IRequestInit<TAppProps> {
  appProps?: TAppProps;
  headers?: HeadersInit;
  status?: number;
}

interface ICreateHandlerOptions<TAppProps> extends ICoreRenderOptions<TAppProps> {
  /** Select SSR or the SPA shell before running route loaders. */
  ssr?: ISsrPolicy;

  /** Must match the basename passed to createStaticHandler. */
  basename?: string;

  /**
   * Development checks; defaults to NODE_ENV !== 'production', overridden by SSR_BOOST_DIAGNOSTICS.
   */
  diagnostics?: boolean;

  /**
   * Supply the document shell, including the application's browser entry script.
   */
  getHtml: (request: Request) => IHtmlShell | Promise<IHtmlShell>;

  /** Observe the initialized context, including bypass responses, before rendering. */
  onContext?: (params: { context: ISsrRequestContext<TAppProps> }) => void;

  /**
   * Initialize request metadata or return a Response to bypass rendering.
   */
  onRequest?: (params: {
    executionContext?: ISsrExecutionContext;
    request: Request;
  }) => IRequestInit<TAppProps> | Promise<IRequestInit<TAppProps> | Response> | Response;
}

/**
 * Create isolated request state and allow request hooks to bypass rendering.
 */
const createHandler = <TAppProps = Record<string, any>>(
  params: ICoreRenderParams<TAppProps>,
  {
    diagnostics,
    getHtml,
    onContext,
    onRequest,
    ssr,
    basename,
    ...options
  }: ICreateHandlerOptions<TAppProps>,
): TSsrHandler => {
  const policy = new SsrPolicy(ssr, params.handler.dataRoutes, basename);
  const spaShell = createSpaShell();

  /**
   * Build fresh context for this request before invoking the renderer.
   */
  return async (request, executionContext) => {
    const isEnabled = isDiagnosticsEnabled(diagnostics);
    const timeline = createTimeline(request, isEnabled);

    try {
      const requestInit = await onRequest?.({ executionContext, request });
      const isBypass = requestInit instanceof Response;
      const metadata = isBypass ? undefined : requestInit;
      const context: ISsrRequestContext<TAppProps> = {
        appProps: (metadata?.appProps ?? {}) as NonNullable<TAppProps>,
        diagnostics: isEnabled ? new Diagnostics(new URL(request.url).pathname) : undefined,
        executionContext,
        html: isBypass ? { header: '', footer: '' } : await getHtml(request),
        request,
        response: {
          headers: new Headers(metadata?.headers),
          status: metadata?.status,
        },
        ...(timeline ? { timeline } : {}),
      };

      onContext?.({ context });

      if (isBypass) {
        const { sessionCookie } = options;

        context.diagnostics?.inspectCachePolicy(
          requestInit.headers,
          Boolean(sessionCookie && hasCookie(request, sessionCookie)),
        );

        const response = await headResponse(request, requestInit);

        return timeline?.response(response) ?? response;
      }

      return await render({ ...params, policy, spaShell }, context, options, executionContext);
    } catch (error) {
      timeline?.abort(error);
      timeline?.end();
      throw error;
    }
  };
};

export type { ICreateHandlerOptions, IHtmlShell, IRequestInit, ISsrPolicy };

export default createHandler;
