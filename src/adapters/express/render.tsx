import chalk from 'chalk';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import React from 'react';
import type { RouterState, StaticHandlerContext, StaticHandler } from 'react-router';
import createFetchRequest from '@adapters/express/create-request';
import type { TApp } from '@adapters/express/entry';
import getRouteAssets from '@adapters/express/route-assets';
import StreamError from '@constants/stream-error';
import type { IServerContext } from '@context/server';
import emitEarlyHints from '@core/early-hints';
import { getHeaderEntries, getSetCookieHeaders } from '@core/headers';
import coreRender from '@core/render';
import type { ICoreRenderOptions, ISsrRequestContext } from '@core/render';
import type createSpaShell from '@core/spa-shell';
import type SsrPolicy from '@core/ssr-policy';
import type { IObtainStreamErrorOut } from '@helpers/obtain-stream-error';
import renderToStream from '@node/render-to-stream';
import createRequestSignal from '@node/request-signal';
import writeEarlyHints from '@node/write-early-hints';
import writeFetchResponse, { writeFetchHeaders } from '@node/write-fetch-response';
import Diagnostics, { isDiagnosticsEnabled } from '@services/diagnostics';
import type ServerConfig from '@services/server-config';

export interface IRequestContext<TAppProps = Record<any, any>> {
  /** @deprecated Use request; planned for removal in 9.0. */
  req: ExpressRequest;
  /** @deprecated Use response.headers/status; planned for removal in 9.0. */
  res: ExpressResponse;
  request: Request;
  response: ISsrRequestContext['response'];
  appProps: NonNullable<TAppProps>;
  html: { header: string; footer: string };
  routerContext?: StaticHandlerContext;
  serverContext?: IServerContext;
  isStream?: boolean;
  isSpa?: boolean;
  matches?: RouterState['matches'];
  hasEarlyHints?: boolean;
  didError?: StreamError;
  timeline?: ISsrRequestContext<TAppProps>['timeline'];
}

export type TRender<TAppProps = Record<any, any>> = (
  config: ServerConfig,
  context: Omit<IRequestContext<TAppProps>, 'request' | 'response'>,
  options: IRenderOptions,
) => Promise<void>;

export interface IRenderParams<TAppProps = Record<string, any>> {
  App: TApp<TAppProps>;
  handler: StaticHandler;
  policy?: SsrPolicy;
  spaShell?: ReturnType<typeof createSpaShell>;
}

export interface IRenderOptions<TAppProps = Record<string, any>> extends Pick<
  ICoreRenderOptions<TAppProps>,
  'documentHeaders' | 'sessionCookie' | 'protectPrivate'
> {
  hydration?: 'early' | 'footer';
  nonce?: string;
  bootstrapScriptContent?: string;
  abortDelay?: number;
  getBody?: (request: ExpressRequest) => BodyInit | null | undefined;
  onRouterReady?: (params: {
    context: IRequestContext<TAppProps>;
  }) => Promise<IRouterReadyOut> | IRouterReadyOut;
  onShellReady?: (params: { context: IRequestContext<TAppProps> }) => IShellReadyOut;
  onShellError?: (params: {
    context: IRequestContext<TAppProps>;
    error: Error;
  }) => string | undefined | void;
  onError?: (params: { context: IRequestContext<TAppProps>; error: IObtainStreamErrorOut }) => void;
  onResponse?: (params: {
    context: IRequestContext<TAppProps>;
    html: string;
    isEnd: boolean;
  }) => string | undefined | void;
  getState?: (params: {
    context: IRequestContext<TAppProps>;
  }) => Record<string, Record<string, any>> | undefined | void;
}

export interface IRouterReadyOut {
  isStream?: boolean;
}

export interface IShellReadyOut {
  header?: string;
  footer?: string;
}

/**
 * Reconstruct parsed bodies only for request methods that can carry them.
 */
const createRenderRequest = (
  req: ExpressRequest,
  signal: AbortSignal,
  getBody: IRenderOptions['getBody'],
): Request => {
  const options: { signal: AbortSignal; body?: BodyInit | null } = { signal };

  if (getBody && req.method !== 'GET' && req.method !== 'HEAD') {
    options.body = getBody(req) ?? null;
  }

  return createFetchRequest(req, options);
};

/**
 * Expose core response metadata to legacy hooks before they run.
 */
const prepareResponse = (context: ISsrRequestContext, res: ExpressResponse): void => {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  res.status(context.response.status ?? 200);
  getHeaderEntries(context.response.headers).forEach(([name, value]) => res.setHeader(name, value));

  const cookies = getSetCookieHeaders(context.response.headers);

  if (cookies.length) {
    res.setHeader('Set-Cookie', cookies);
  }
};

/**
 * Copy legacy hook metadata back to the core; cookies remain on the live response.
 */
const syncResponse = (
  context: ISsrRequestContext,
  res: ExpressResponse,
  previous: ISsrRequestContext['response'],
): void => {
  // Apply Fetch metadata edits before reading legacy metadata back. Unchanged
  // Fetch values must not overwrite edits made through the live Express response.
  if (!res.headersSent && !res.writableEnded) {
    if (context.response.status !== previous.status) {
      res.status(context.response.status ?? 200);
    }

    const names = new Set([...previous.headers.keys(), ...context.response.headers.keys()]);

    for (const name of names) {
      if (context.response.headers.get(name) === previous.headers.get(name)) {
        continue;
      }

      if (!context.response.headers.has(name)) {
        res.removeHeader(name);
      } else {
        res.setHeader(
          name,
          name === 'set-cookie'
            ? getSetCookieHeaders(context.response.headers)
            : context.response.headers.get(name)!,
        );
      }
    }
  }

  const headers = new Headers(context.response.headers);

  headers.delete('Set-Cookie');

  for (const [name, value] of Object.entries(res.getHeaders())) {
    if (name.toLowerCase() === 'set-cookie' || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, typeof value === 'number' ? String(value) : value);
    }
  }

  context.response.headers = headers;
  context.response.status = res.statusCode;
};

/**
 * Preserve Express redirect formatting before falling back to the Fetch body writer.
 */
const writeResponse = async (res: ExpressResponse, response: Response): Promise<void> => {
  const location = response.headers.get('Location');

  if (
    location &&
    response.status >= 300 &&
    response.status < 400 &&
    !res.headersSent &&
    !res.writableEnded &&
    !res.destroyed
  ) {
    writeFetchHeaders(res, response);
    await response.body?.cancel();
    res.redirect(response.status, location);

    return;
  }

  await writeFetchResponse(res, response);
};

/**
 * Render application
 */
async function render(
  { App, handler, policy, spaShell }: IRenderParams,
  config: ServerConfig,
  initialContext: Omit<IRequestContext, 'request' | 'response'>,
  {
    onRouterReady,
    onShellReady,
    onResponse,
    onShellError,
    onError,
    getBody,
    getState,
    hydration,
    nonce,
    bootstrapScriptContent,
    documentHeaders,
    sessionCookie,
    protectPrivate,
    abortDelay = 15000,
  }: IRenderOptions,
): Promise<void> {
  const { appProps, html: shellHtml, req, res } = initialContext;
  const Logger = config.getLogger();
  const requestSignal = createRequestSignal(req, res);
  try {
    const context: IRequestContext = Object.assign(initialContext, {
      request: createRenderRequest(req, requestSignal.signal, getBody),
      response: { headers: new Headers() },
    });
    const coreContext: ISsrRequestContext = {
      appProps,
      diagnostics: isDiagnosticsEnabled(!config.isProd)
        ? new Diagnostics(new URL(context.request.url).pathname, Logger)
        : undefined,
      html: shellHtml,
      request: context.request,
      response: context.response,
    };

    // Keep plain data properties in production, even with diagnostics forced on.
    // Adapter internals retain req/res locals so only consumer reads warn.
    if (!config.isProd && coreContext.diagnostics) {
      const { diagnostics } = coreContext;

      for (const name of ['req', 'res'] as const) {
        let value = context[name];

        Object.defineProperty(context, name, {
          configurable: true,
          enumerable: true,
          get: () => {
            diagnostics.deprecatedReqRes();

            return value;
          },
          set: (next: typeof value) => {
            value = next;
          },
        });
      }
    }

    const { response: initialResponse } = coreContext;

    syncResponse(coreContext, res, {
      headers: new Headers(initialResponse.headers),
      status: initialResponse.status,
    });

    if (initialResponse.status === 200) {
      initialResponse.status = undefined;
    }

    /**
     * Keep legacy hooks attached to their original mutable request context.
     */
    const syncContext = (updated: ISsrRequestContext): IRequestContext => {
      context.request = updated.request;
      context.response = updated.response;
      context.didError = updated.didError;
      context.html = updated.html;
      context.isStream = updated.isStream;
      context.isSpa = updated.isSpa;
      context.matches = updated.matches;
      context.routerContext = updated.routerContext;
      context.serverContext = updated.serverContext;
      context.timeline = updated.timeline;

      return context;
    };
    const response = await coreRender(
      {
        /**
         * Preserve the legacy App server props and live Express request.
         */
        createApp: (children, updated) => (
          <App server={{ ...updated.appProps, req }}>{children}</App>
        ),
        handler,
        policy,
        spaShell,
        renderToStream,
      },
      coreContext,
      {
        abortDelay,
        hydration,
        nonce,
        bootstrapScriptContent,
        documentHeaders,
        sessionCookie,
        protectPrivate,

        /**
         * Read custom state through the legacy request context.
         */
        getState: getState
          ? ({ context: updated }) => getState({ context: syncContext(updated) })
          : undefined,

        /**
         * Preserve legacy error hooks and keep expected aborts at info level.
         */
        onError: ({ context: updated, error }) => {
          const { code, message } = error;

          onError?.({ context: syncContext(updated), error });
          Logger.info(chalk.red(`Stream error. Code: ${code}`));

          if (
            [
              StreamError.RenderAborted,
              StreamError.RenderTimeout,
              StreamError.RenderCancel,
            ].includes(code)
          ) {
            Logger.info(chalk.dim(message));

            return;
          }

          const { original } = error;

          Logger.error(original as string);
        },

        /**
         * Forward HTML chunks and the end signal through the legacy request context.
         */
        onResponse: onResponse
          ? ({ context: updated, html, isEnd }) =>
              onResponse({ context: syncContext(updated), html, isEnd })
          : undefined,

        /**
         * Expose router state before the legacy hook chooses a rendering mode.
         */
        onRouterReady: onRouterReady
          ? ({ context: updated }) => onRouterReady({ context: syncContext(updated) })
          : undefined,

        /**
         * Let the legacy hook replace the default shell-error response.
         */
        onShellError: onShellError
          ? ({ context: updated, error }) => onShellError({ context: syncContext(updated), error })
          : undefined,

        /**
         * Synchronize response metadata around the legacy shell hook.
         */
        onShellReady: ({ context: updated }) => {
          const legacyContext = syncContext(updated);

          prepareResponse(updated, res);

          const previous = {
            headers: new Headers(updated.response.headers),
            status: updated.response.status,
          };

          const shell = onShellReady?.({ context: legacyContext });

          syncResponse(updated, res, previous);

          return shell ?? {};
        },

        /**
         * Prepare Vite assets and send requested early hints before rendering.
         */
        prepare: async ({ context: updated, executionContext }) => {
          const legacyContext = syncContext(updated);
          const { matches, isSpa } = updated;
          const manifest = await getRouteAssets(config, matches, isSpa);
          const hints = manifest.injectAssets(legacyContext, Boolean(legacyContext.hasEarlyHints));

          if (legacyContext.hasEarlyHints) {
            await emitEarlyHints(executionContext, hints);
          }
        },
        routerRequestContext: context,
      },
      {
        /**
         * Deliver early hints through the existing Express response.
         */
        onEarlyHints: (headers) => writeEarlyHints(res, headers),
      },
    );

    syncContext(coreContext);

    await writeResponse(res, response);
  } finally {
    requestSignal.dispose();
  }
}

export default render;
