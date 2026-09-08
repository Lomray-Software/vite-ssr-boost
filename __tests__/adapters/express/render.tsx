// @vitest-environment node
import type { PropsWithChildren } from 'react';
import { createStaticHandler } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StreamError from '@constants/stream-error';
import render from '@adapters/express/render';
import type { IRenderOptions, IRequestContext } from '@adapters/express/render';
import Diagnostics from '@services/diagnostics';

const { coreRenderMock, createFetchRequestMock, injectAssetsMock, writeFetchResponseMock } =
  vi.hoisted(() => ({
    coreRenderMock: vi.fn(),
    createFetchRequestMock: vi.fn(),
    injectAssetsMock: vi.fn(),
    writeFetchResponseMock: vi.fn(),
  }));

vi.mock('@core/render', () => ({ default: coreRenderMock }));
vi.mock('@adapters/express/create-request', async (importOriginal) => {
  const { default: createFetchRequest } =
    await importOriginal<typeof import('@adapters/express/create-request')>();

  createFetchRequestMock.mockImplementation(createFetchRequest);

  return { default: createFetchRequestMock };
});
vi.mock('@node/write-fetch-response', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@node/write-fetch-response')>()),
  default: writeFetchResponseMock,
}));
vi.mock('@services/ssr-manifest', () => ({
  default: {
    get: vi.fn(() => ({
      injectAssets: injectAssetsMock,
      prepareDevAssets: vi.fn(),
    })),
  },
}));

const App = ({ children }: PropsWithChildren) => children;

describe('legacy Express render adapter', () => {
  const createContext = () => {
    const responseHeaders: Record<string, string | string[]> = {};
    const res: Record<string, any> = {
      getHeaders: vi.fn(() => responseHeaders),
      headersSent: false,
      off: vi.fn(),
      once: vi.fn(),
      redirect: vi.fn(),
      removeHeader: vi.fn((name: string) => {
        delete responseHeaders[name.toLowerCase()];
      }),
      setHeader: vi.fn((name: string, value: string | string[]) => {
        responseHeaders[name.toLowerCase()] = value;

        return res;
      }),
      status: vi.fn((status: number) => {
        res.statusCode = status;

        return res;
      }),
      statusCode: 200,
      writableEnded: false,
    };
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    };
    const config = {
      isProd: false,
      getLogger: () => logger,
    };
    const context: Record<string, any> = {
      appProps: { value: 'app' },
      html: { footer: '</html>', header: '<html>' },
      req: {
        get: vi.fn((name: string) => context.req.headers[name.toLowerCase()]),
        headers: {
          host: 'example.test',
          'user-agent': 'Googlebot',
          cookie: 'isCrawler=1; session=test',
        },
        method: 'GET',
        off: vi.fn(),
        once: vi.fn(),
        originalUrl: '/details?source=hook',
        protocol: 'https',
        url: '/details',
      },
      res,
    };

    return { config, context, logger, res };
  };

  beforeEach(() => {
    const key = Symbol.for('@lomray/vite-ssr-boost/diagnostics');
    (globalThis as Record<symbol, Set<string>>)[key]?.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(['req', 'res'] as const)(
    'emits SSR_BOOST_DEPRECATED_REQ_RES once per process when a hook reads context.%s',
    async (field) => {
      const warnings: unknown[] = [];
      for (const route of ['/first', '/second']) {
        const { config, context, logger } = createContext();
        const original = context[field];
        context.req.originalUrl = route;
        coreRenderMock.mockImplementation(async (_, updated, options) => {
          expect(logger.warn).not.toHaveBeenCalled();
          await options.onRouterReady({ context: updated });
          options.getState({ context: updated });
          return new Response('rendered');
        });
        await render({ App, handler: {} as never }, config as never, context as never, {
          onRouterReady: ({ context: hookContext }) => {
            expect(hookContext[field]).toBe(original);
            expect(Object.keys(hookContext)).toContain(field);
            return {};
          },
          getState: ({ context: hookContext }) => {
            expect(hookContext.req).toBe(context.req);
            expect(hookContext.res).toBe(context.res);
            return {};
          },
        });
        warnings.push(...logger.warn.mock.calls.map(([message]) => message));
      }
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('SSR_BOOST_DEPRECATED_REQ_RES');
      expect(warnings[0]).toContain('context.request, context.response.headers/context.response.status');
      expect(warnings[0]).toContain('9.0');
      expect(warnings[0]).toContain('diagnostics#ssr_boost_deprecated_req_res');
    },
  );

  it.each([
    [true, '1'],
    [false, '0'],
  ] as const)('keeps plain req/res properties with isProd=%s and diagnostics=%s', async (isProd, override) => {
    vi.stubEnv('SSR_BOOST_DIAGNOSTICS', override);
    const { config, context, logger } = createContext();
    config.isProd = isProd;
    coreRenderMock.mockImplementation(async (_, updated, options) => {
      await options.onRouterReady({ context: updated });
      return new Response('rendered');
    });
    await render({ App, handler: {} as never }, config as never, context as never, {
      onRouterReady: ({ context: hookContext }) => {
        for (const name of ['req', 'res'] as const) {
          expect(Object.getOwnPropertyDescriptor(hookContext, name)).toEqual({
            configurable: true,
            enumerable: true,
            value: context[name],
            writable: true,
          });
        }
        return {};
      },
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  /**
   * Preserve reusable hook headers while emitting each response's cookies independently.
   */
  it('does not consume cookies from Headers shared by a shell hook', async () => {
    const sharedHeaders = new Headers({ 'X-Shared': 'yes' });

    sharedHeaders.append('Set-Cookie', 'one=1; Path=/');
    sharedHeaders.append('Set-Cookie', 'two=2; Path=/');

    const { default: coreRender } =
      await vi.importActual<typeof import('@core/render')>('@core/render');
    const handler = createStaticHandler([{ path: '*', Component: () => 'BODY' }]);

    for (let index = 0; index < 2; index += 1) {
      const { config, context, res } = createContext();

      coreRenderMock.mockImplementationOnce(coreRender);
      writeFetchResponseMock.mockImplementationOnce(async (_, response: Response) => {
        await response.text();
      });
      await render({ App, handler }, config as never, context as never, {

        /**
         * Reuse application-owned metadata across otherwise independent requests.
         */
        onShellReady: ({ context: hookContext }) => {
          hookContext.response.headers = sharedHeaders;

          return {};
        },
      });

      expect(res.getHeaders()['set-cookie']).toEqual(['one=1; Path=/', 'two=2; Path=/']);
      expect(sharedHeaders.getSetCookie()).toEqual(['one=1; Path=/', 'two=2; Path=/']);
    }
  });

  it('supports Fetch request and response metadata without a deprecation warning', async () => {
    const { config, context, logger, res } = createContext();
    const { default: coreRender } =
      await vi.importActual<typeof import('@core/render')>('@core/render');
    const handler = createStaticHandler([{ path: '*', Component: () => 'BODY' }]);
    coreRenderMock.mockImplementationOnce(coreRender);
    writeFetchResponseMock.mockImplementationOnce(async (_, response: Response) => {
      expect(response.status).toBe(202);
      expect(response.headers.get('x-modern')).toBe('shell');
      expect(response.headers.has('x-remove')).toBe(false);
      expect(res.getHeaders()['set-cookie']).toEqual(['one=1; Path=/', 'two=2; Path=/']);
      await response.text();
    });
    await render({ App, handler }, config as never, context as never, {
      onRouterReady: ({ context: hookContext }) => {
        expect(hookContext.request.headers.get('user-agent')).toBe('Googlebot');
        hookContext.response.status = 201;
        hookContext.response.headers.set('x-modern', 'router');
        hookContext.response.headers.set('x-remove', 'router');
        return {};
      },
      onShellReady: ({ context: hookContext }) => {
        hookContext.response.status = 202;
        hookContext.response.headers.set('x-modern', 'shell');
        hookContext.response.headers.delete('x-remove');
        hookContext.response.headers.append('set-cookie', 'one=1; Path=/');
        hookContext.response.headers.append('set-cookie', 'two=2; Path=/');
        return {};
      },
    });
    expect(writeFetchResponseMock).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    [false, 'production', undefined, true],
    [true, 'development', undefined, false],
    [false, 'development', '0', false],
    [true, 'production', '1', true],
  ] as const)(
    'uses managed mode isProd=%s over NODE_ENV=%s with override=%s',
    async (isProd, environment, override, enabled) => {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('SSR_BOOST_DIAGNOSTICS', override);
      const { config, context, logger } = createContext();
      config.isProd = isProd;
      context.req.originalUrl = `/managed-${isProd}-${environment}-${override ?? 'default'}`;
      coreRenderMock.mockImplementation(async (_, updated) => {
        expect(updated.diagnostics instanceof Diagnostics).toBe(enabled);
        updated.diagnostics?.inspectOnResponse(new Set());
        return new Response('rendered');
      });
      await render({ App, handler: {} as never }, config as never, context as never, {});
      expect(logger.warn).toHaveBeenCalledTimes(enabled ? 1 : 0);
    },
  );

  it.each(['GET', 'POST'])(
    'shares the Fetch %s request across all render hooks',
    async (method) => {
      const { config, context } = createContext();
      context.req.method = method;
      let coreRequest: Request;
      const requests: Request[] = [];
      const inspectContext = ({ context: hookContext }: { context: IRequestContext }) => {
        expect(hookContext).toBe(context);
        expect(hookContext.req).toBe(context.req);
        expect(hookContext.res).toBe(context.res);
        expect(hookContext.request).toBeInstanceOf(Request);
        expect(hookContext.request).toBe(coreRequest);
        expect(hookContext.request.url).toBe('https://example.test/details?source=hook');
        expect(hookContext.request.method).toBe(method);
        expect(hookContext.request.headers.get('user-agent')).toBe(
          context.req.headers['user-agent'],
        );
        expect(hookContext.request.headers.get('cookie')).toBe(context.req.headers.cookie);
        requests.push(hookContext.request);
      };
      const onError = vi.fn(inspectContext);
      const onShellError = vi.fn(inspectContext);
      const onResponse = vi.fn((params) => {
        inspectContext(params);
        return params.html;
      });
      const onRouterReady = vi.fn((params) => {
        inspectContext(params);
        return { isStream: true };
      });
      const onShellReady = vi.fn((params) => {
        inspectContext(params);
        return { header: '<head>' };
      });
      const getState = vi.fn((params) => {
        inspectContext(params);
        return { app: { value: 1 } };
      });
      const getBody = vi.fn(() => 'request body');
      const response = new Response('rendered');
      const shellError = new Error('shell failed');

      coreRenderMock.mockImplementation(async (_, coreContext, options) => {
        coreRequest = coreContext.request;
        // Router loaders can see the context before any hook synchronizes it.
        expect(options.routerRequestContext).toBe(context);
        expect(context.request).toBe(coreRequest);
        coreContext.routerContext = { basename: '/base' };
        coreContext.serverContext = { isServer: true, response: null };
        await options.prepare({ context: coreContext });
        await options.onRouterReady({ context: coreContext });
        options.onShellReady({ context: coreContext });
        options.onResponse({ context: coreContext, html: 'chunk', isEnd: false });
        options.getState({ context: coreContext });
        options.onError({
          context: coreContext,
          error: {
            code: StreamError.Unknown,
            message: 'broken',
            original: new Error('broken'),
          },
        });
        options.onShellError({ context: coreContext, error: shellError });

        expect(coreRequest.signal.aborted).toBe(false);
        const [, abort] = context.req.once.mock.calls.find(
          ([event]: [string, () => void]) => event === 'aborted',
        );
        abort();
        expect(requests.every((request) => request.signal.aborted)).toBe(true);

        return response;
      });

      await render(
        { App: App as never, handler: { handler: true } as never },
        config as never,
        context as never,
        {
          getBody,
          getState,
          onError,
          onResponse,
          onRouterReady,
          onShellError,
          onShellReady,
        },
      );

      expect(createFetchRequestMock).toHaveBeenCalledWith(context.req, {
        signal: expect.any(AbortSignal),
        ...(method === 'POST' ? { body: 'request body' } : {}),
      });
      expect(createFetchRequestMock).toHaveBeenCalledOnce();
      expect(getBody).toHaveBeenCalledTimes(method === 'POST' ? 1 : 0);
      expect(requests).toHaveLength(6);
      expect(new Set(requests).size).toBe(1);
      expect(injectAssetsMock).toHaveBeenCalledWith(context, false);
      expect(onRouterReady).toHaveBeenCalledWith({ context });
      expect(onShellReady).toHaveBeenCalledWith({ context });
      expect(onShellError).toHaveBeenCalledWith({ context, error: shellError });
      expect(onResponse).toHaveBeenCalledWith({ context, html: 'chunk', isEnd: false });
      expect(getState).toHaveBeenCalledWith({ context });
      expect(onError).toHaveBeenCalledWith({
        context,
        error: expect.objectContaining({ code: StreamError.Unknown }),
      });
      expect(writeFetchResponseMock).toHaveBeenCalledWith(context.res, response);
      expect(context.req.off).toHaveBeenCalledWith('aborted', expect.any(Function));
      expect(context.res.off).toHaveBeenCalledWith('close', expect.any(Function));
    },
  );

  it.each([true, false])(
    'transforms chunks and flushes after the footer with isStream=%s',
    async (isStream) => {
      const { default: coreRender } =
        await vi.importActual<typeof import('@core/render')>('@core/render');
      const { config, context } = createContext();
      const handler = createStaticHandler([{ path: '*', Component: () => 'BODY' }]);
      const onResponse = vi.fn<NonNullable<IRenderOptions['onResponse']>>(({ html, isEnd }) => {
        if (isEnd) {
          return 'FLUSHED';
        }

        return html === context.html.header ? '' : undefined;
      });
      let output = '';

      coreRenderMock.mockImplementationOnce(coreRender);
      writeFetchResponseMock.mockImplementationOnce(async (_, response: Response) => {
        output = await response.text();
      });

      await render({ App: App as never, handler }, config as never, context as never, {
        onResponse,
        onRouterReady: () => ({ isStream }),
      });

      const calls = onResponse.mock.calls.map(([params]) => params);
      const chunks = calls.slice(0, -1);

      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.every((params) => params.context === context && params.isEnd === false)).toBe(
        true,
      );
      expect(chunks[0].html).toBe(context.html.header);
      expect(chunks.at(-1)?.html).toContain(context.html.footer);
      expect(calls.filter(({ isEnd }) => isEnd)).toEqual([{ context, html: '', isEnd: true }]);
      expect(calls.at(-1)).toEqual({ context, html: '', isEnd: true });
      expect(context.isStream).toBe(isStream);
      expect(output).toBe(
        `${chunks
          .slice(1)
          .map(({ html }) => html)
          .join('')}FLUSHED`,
      );
      expect(output).toContain('BODY');
      expect(output).toContain('window.__staticRouterHydrationData');
      expect(output.endsWith(`${context.html.footer}FLUSHED`)).toBe(true);
    },
  );

  it.each([false, true])(
    'passes managed document rules through to real core rendering (session=%s)',
    async (authenticated) => {
      const { default: coreRender } =
        await vi.importActual<typeof import('@core/render')>('@core/render');
      const { config, context } = createContext();
      context.req.headers.cookie = authenticated ? 'session=secret' : 'theme=dark';
      let headers: Headers;
      coreRenderMock.mockImplementationOnce(coreRender);
      writeFetchResponseMock.mockImplementationOnce(async (_, response: Response) => {
        headers = response.headers;
        await response.text();
      });
      await render(
        {
          App: App as never,
          handler: createStaticHandler([{ path: '*', Component: () => 'Page' }]),
        },
        config as never,
        context as never,
        {
          sessionCookie: 'session',
          documentHeaders: [{ when: () => true, set: { 'Cache-Control': 'public, s-maxage=30' } }],
        },
      );
      expect(headers!.get('Cache-Control')).toBe(
        authenticated ? 'private, no-store' : 'public, s-maxage=30',
      );
    },
  );

  it('keeps Express redirect behavior for legacy consumers', async () => {
    const { config, context, res } = createContext();

    coreRenderMock.mockResolvedValue(
      new Response(null, {
        headers: { Location: '/redirect' },
        status: 302,
      }),
    );

    await render(
      { App: App as never, handler: { handler: true } as never },
      config as never,
      context as never,
      {},
    );

    expect(res.redirect).toHaveBeenCalledWith(302, '/redirect');
    expect(writeFetchResponseMock).not.toHaveBeenCalled();
  });

  it('syncs the live Express response before getState without a user shell hook', async () => {
    const { config, context, res } = createContext();
    const getState = vi.fn(({ context: legacyContext }) => {
      expect(legacyContext.res.statusCode).toBe(404);
      expect(legacyContext.res.getHeaders()['x-core']).toBe('yes');

      return {};
    });
    const response = new Response('rendered');

    coreRenderMock.mockImplementation(async (_, coreContext, options) => {
      coreContext.response.status = 404;
      coreContext.response.headers.set('X-Core', 'yes');
      options.onShellReady({ context: coreContext });
      options.getState({ context: coreContext });

      return response;
    });

    await render(
      { App: App as never, handler: { handler: true } as never },
      config as never,
      context as never,
      { getState },
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getState).toHaveBeenCalledOnce();
    expect(writeFetchResponseMock).toHaveBeenCalledWith(res, response);
  });
});
