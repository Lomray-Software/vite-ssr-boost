import { hasCookie } from '@core/document-headers';
import headResponse from '@core/head-response';
import render from '@core/render';
import type { ICoreRenderOptions, ICoreRenderParams, ISsrRequestContext } from '@core/render';
import createSpaShell from '@core/spa-shell';
import SsrPolicy from '@core/ssr-policy';
import type { ISsrPolicy } from '@core/ssr-policy';
import type { ISsrExecutionContext, TSsrHandler } from '@core/types';
import Diagnostics, { isDiagnosticsEnabled } from '@services/diagnostics';

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
  { diagnostics, getHtml, onRequest, ssr, basename, ...options }: ICreateHandlerOptions<TAppProps>,
): TSsrHandler => {
  const policy = new SsrPolicy(ssr, params.handler.dataRoutes, basename);
  const spaShell = createSpaShell();

  /**
   * Build fresh context for this request before invoking the renderer.
   */
  return async (request, executionContext) => {
    const requestDiagnostics = isDiagnosticsEnabled(diagnostics)
      ? new Diagnostics(new URL(request.url).pathname)
      : undefined;
    const requestInit = await onRequest?.({ executionContext, request });

    if (requestInit instanceof Response) {
      requestDiagnostics?.inspectCachePolicy(
        requestInit.headers,
        Boolean(options.sessionCookie && hasCookie(request, options.sessionCookie)),
      );

      return headResponse(request, requestInit);
    }

    const context: ISsrRequestContext<TAppProps> = {
      appProps: (requestInit?.appProps ?? {}) as NonNullable<TAppProps>,
      diagnostics: requestDiagnostics,
      html: await getHtml(request),
      request,
      response: {
        headers: new Headers(requestInit?.headers),
        status: requestInit?.status,
      },
    };

    return render({ ...params, policy, spaShell }, context, options, executionContext);
  };
};

export type { ICreateHandlerOptions, IHtmlShell, IRequestInit, ISsrPolicy };

export default createHandler;
