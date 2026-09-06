import type { FC, PropsWithChildren } from 'react';
import React from 'react';
import type { RouteObject } from 'react-router';
import { createStaticHandler } from 'react-router';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions, IHtmlShell } from '@core/handler';
import type { TRenderToStream } from '@core/render';
import type { TRouteObject } from '@interfaces/route-object';
import type { ILoadHtmlShellOptions } from '@node/production';
import type RequestTimeline from '@services/request-timeline';
import { TEST_ORIGIN } from './requests';
import TestResponse from './response';

interface ITestRequestInit extends RequestInit {
  isStream?: boolean;

  /** Whole-request deadline, including loaders and body consumption. */
  timeout?: number;
}

interface ITestHandlerOptions<TAppProps> extends Omit<ICreateHandlerOptions<TAppProps>, 'getHtml'> {
  routes: TRouteObject[] | RouteObject[];
  App?: FC<PropsWithChildren<{ server: TAppProps }>>;
  shell?: IHtmlShell | ILoadHtmlShellOptions;
  routerOptions?: Parameters<typeof createStaticHandler>[1];
  renderToStream?: TRenderToStream;
  signal?: AbortSignal;

  /** Default whole-request deadline in milliseconds; omitted means no deadline. */
  timeout?: number;
}

interface ITestHandler {
  fetch: (input: string | Request, init?: ITestRequestInit) => Promise<TestResponse>;
}

type TLoadShell = (options: ILoadHtmlShellOptions) => Promise<() => IHtmlShell>;

/**
 * Supply a complete document around the rendered test application.
 */
const DEFAULT_SHELL: IHtmlShell = {
  header: '<!doctype html><html><head></head><body><div id="root">',
  footer: '</div><script type="module">/* test browser entry */</script></body></html>',
};

/** Share the Fetch-only implementation between Node and conditional edge exports. */
const testHandlerFactory =
  (renderer: TRenderToStream, loadShell: TLoadShell) =>
  <TAppProps = Record<string, any>,>({
    routes,
    App,
    shell = DEFAULT_SHELL,
    routerOptions,
    renderToStream = renderer,
    signal: defaultSignal,
    timeout: defaultTimeout,
    onContext,
    onRouterReady,
    ...options
  }: ITestHandlerOptions<TAppProps>): ITestHandler => {
    const handler = createStaticHandler(routes as RouteObject[], routerOptions);
    let fileShell: Promise<() => IHtmlShell> | undefined;

    /**
     * Cache file loading while returning a fresh shell for every request.
     */
    const getHtml = async (): Promise<IHtmlShell> => {
      if ('indexFile' in shell) {
        fileShell ??= loadShell(shell);

        return (await fileShell)();
      }

      return { ...shell };
    };

    return {
      /**
       * Render one cancellable request and collect its response assertions.
       */
      fetch: async (input, { isStream, timeout = defaultTimeout, signal, ...init } = {}) => {
        const started = performance.now();
        const controller = new AbortController();
        const signals = [
          controller.signal,
          defaultSignal,
          signal,
          input instanceof Request ? input.signal : undefined,
        ].filter((item): item is AbortSignal => Boolean(item));
        const combined = AbortSignal.any(signals);
        const request = new Request(
          typeof input === 'string' ? new URL(input, TEST_ORIGIN) : input,
          {
            ...init,
            signal: combined,
          },
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timeline: RequestTimeline | undefined;
        let rejectAbort!: (reason: unknown) => void;

        /**
         * Allow cancellation to settle before hooks that ignore the signal.
         */
        const aborted = new Promise<never>((_, reject) => {
          rejectAbort = reject;
        });

        /**
         * Reject pending rendering with the original abort reason.
         */
        const onAbort = (): void => rejectAbort(combined.reason);

        /**
         * Release the deadline timer and abort listener after completion.
         */
        const cleanup = (): void => {
          clearTimeout(timer);
          combined.removeEventListener('abort', onAbort);
        };

        combined.addEventListener('abort', onAbort, { once: true });

        if (timeout !== undefined) {
          if (!Number.isFinite(timeout) || timeout < 0) {
            cleanup();
            throw new RangeError('timeout must be a finite, non-negative number of milliseconds.');
          }

          /**
           * Cancel rendering and body consumption when the deadline expires.
           */
          timer = setTimeout(
            () =>
              controller.abort(
                new DOMException(`SSR test timed out after ${timeout}ms`, 'TimeoutError'),
              ),
            timeout,
          );
        }

        try {
          combined.throwIfAborted();
          const fetch = createHandler<TAppProps>(
            {
              handler,
              renderToStream,

              /**
               * Wrap matched content with the optional test application.
               */
              createApp: (children, context) =>
                App ? <App server={context.appProps}>{children}</App> : children,
            },
            {
              ...options,
              getHtml,

              /**
               * Retain the request timeline before forwarding context observation.
               */
              onContext: (params) => {
                ({ timeline } = params.context);
                onContext?.(params);
              },

              /**
               * Apply a per-request streaming override after the application hook.
               */
              onRouterReady: async (params) => {
                const result = await onRouterReady?.(params);

                return isStream === undefined ? (result ?? {}) : { ...result, isStream };
              },
            },
          );
          const pending = fetch(request);

          /**
           * Hooks can ignore cancellation; release a response if it arrives after the deadline.
           */
          void pending
            .then((response) => {
              if (combined.aborted) {
                return response.body?.cancel(combined.reason);
              }

              return undefined;
            })
            .catch(() => undefined);

          const response = await Promise.race([pending, aborted]);

          return new TestResponse(response, {
            started,
            timeline,
            signal: combined,
            onComplete: cleanup,
          });
        } catch (error) {
          cleanup();
          timeline?.abort(error);
          timeline?.end();
          throw error;
        }
      },
    };
  };

export type { ITestHandler, ITestHandlerOptions, ITestRequestInit };

export default testHandlerFactory;
