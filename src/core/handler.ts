import documentHeaders, { hasCookie } from '@core/document-headers';
import HandlerRuntime from '@core/handler-runtime';
import type { IHandlerRuntimeOptions } from '@core/handler-runtime';
import headResponse from '@core/head-response';
import type { INotFoundRenderResult } from '@core/not-found';
import render from '@core/render';
import type { ICoreRenderOptions, ICoreRenderParams, ISsrRequestContext } from '@core/render';
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

interface ICreateHandlerOptions<TAppProps>
  extends ICoreRenderOptions<TAppProps>, IHandlerRuntimeOptions {
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
    requestGuard,
    notFound,
    admission,
    ...options
  }: ICreateHandlerOptions<TAppProps>,
  runtime = new HandlerRuntime(params.handler.dataRoutes, {
    ssr,
    basename,
    requestGuard,
    notFound,
    admission,
  }),
): TSsrHandler => {
  const { guard, cache } = runtime;
  const policy = params.policy ?? runtime.policy;
  const spaShell = params.spaShell ?? runtime.spaShell;

  /**
   * Build fresh context for this request before invoking the renderer.
   */
  return async (request, executionContext) => {
    const isEnabled = isDiagnosticsEnabled(diagnostics);
    const timeline = createTimeline(request, isEnabled);

    try {
      const guarded = await guard?.handle(request);

      if (guarded?.reason) {
        timeline?.record('guard.reject', { reason: guarded.reason });
      }

      if (guarded?.response) {
        return timeline?.response(guarded.response) ?? guarded.response;
      }

      const isMissing = guarded?.notFound;
      const mode = runtime.notFound;

      if (isMissing && (mode instanceof Response || typeof mode === 'function')) {
        const custom = (typeof mode === 'function' ? await mode(request) : mode).clone();
        const headers = new Headers(custom.headers);

        headers.set('Cache-Control', 'private, no-store');

        if (request.method === 'HEAD') {
          /** A cloned tee branch cannot await cancellation while its reusable source stays open. */
          void custom.body?.cancel().catch(() => undefined);
        }

        const response = new Response(request.method === 'HEAD' ? null : custom.body, {
          status: 404,
          headers: options.documentHeaders
            ? documentHeaders(options.documentHeaders, options)({ request, response: { headers } })
            : headers,
        });

        return timeline?.response(response) ?? response;
      }

      /** Initialize anonymous cache misses through the same hooks as ordinary renders. */
      const execute = async (
        renderRequest: Request,
        isCached = false,
      ): Promise<INotFoundRenderResult> => {
        const requestInit = onRequest
          ? await onRequest({ executionContext, request: renderRequest })
          : undefined;
        const isBypass = requestInit instanceof Response;
        const metadata = isBypass ? undefined : requestInit;
        const context = Object.assign(params.requestContext ?? {}, {
          appProps: (metadata?.appProps ?? {}) as NonNullable<TAppProps>,
          diagnostics: isEnabled ? new Diagnostics(new URL(renderRequest.url).pathname) : undefined,
          executionContext,
          html: isBypass ? { header: '', footer: '' } : await getHtml(renderRequest),
          request: renderRequest,
          matches: guarded?.matches,
          notFound: isMissing
            ? isCached
              ? 'cached'
              : mode === 'spa'
                ? 'spa'
                : 'render'
            : undefined,
          response: {
            headers: new Headers(metadata?.headers),
            status: metadata?.status,
          },
          ...(!isCached && timeline ? { timeline } : {}),
        }) as ISsrRequestContext<TAppProps>;

        if (isMissing) {
          context.response.headers.set('Cache-Control', 'private, no-store');
        }

        onContext?.({ context });

        if (isBypass) {
          const { sessionCookie } = options;

          context.diagnostics?.inspectCachePolicy(
            requestInit.headers,
            Boolean(sessionCookie && hasCookie(renderRequest, sessionCookie)),
          );
          const response = await headResponse(renderRequest, requestInit);

          return { response: context.timeline?.response(response) ?? response, isCacheable: false };
        }

        const response = await render(
          { ...params, policy, spaShell, admission: runtime.admission },
          context,
          isCached ? { ...options, documentHeaders: undefined } : options,
          executionContext,
        );

        return {
          response,
          isCacheable: !context.didError && context.routerContext?.statusCode === 404,
          routerContext: context.routerContext,
        };
      };

      if (isMissing && cache && options.nonce === undefined) {
        const response = await cache.get(
          request,
          (anonymous) => execute(anonymous, true),
          options.documentHeaders
            ? (headers, routerContext) =>
                documentHeaders(
                  options.documentHeaders!,
                  options,
                )({ request, routerContext, response: { headers } })
            : undefined,
        );

        return timeline?.response(response) ?? response;
      }

      return (await execute(request)).response;
    } catch (error) {
      timeline?.abort(error);
      timeline?.end();
      throw error;
    }
  };
};

export type { ICreateHandlerOptions, IHtmlShell, IRequestInit, ISsrPolicy };

export default createHandler;

export type { IAdmissionOptions, IAdmissionEvent, TAdmissionOverload } from '@core/admission';

export type {
  IRequestGuardOptions,
  IRequestGuardDecisionContext,
  TRequestGuardReason,
} from '@core/request-guard';

export type { TNotFoundOptions, ICachedNotFoundOptions } from '@core/not-found';
