import headResponse from '@core/head-response';
import render from '@core/render';
import type { ICoreRenderOptions, ICoreRenderParams, ISsrRequestContext } from '@core/render';
import type { ISsrExecutionContext, TSsrHandler } from '@core/types';

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
  { getHtml, onRequest, ...options }: ICreateHandlerOptions<TAppProps>,
): TSsrHandler => {
  /**
   * Build fresh context for this request before invoking the renderer.
   */
  return async (request, executionContext) => {
    const requestInit = await onRequest?.({ executionContext, request });

    if (requestInit instanceof Response) {
      return headResponse(request, requestInit);
    }

    const context: ISsrRequestContext<TAppProps> = {
      appProps: (requestInit?.appProps ?? {}) as NonNullable<TAppProps>,
      html: await getHtml(request),
      request,
      response: {
        headers: new Headers(requestInit?.headers),
        status: requestInit?.status,
      },
    };

    return render(params, context, options, executionContext);
  };
};

export type { ICreateHandlerOptions, IHtmlShell, IRequestInit };

export default createHandler;
