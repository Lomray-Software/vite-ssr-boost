// @vitest-environment node
import type { PropsWithChildren } from 'react';
import { createStaticHandler } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
      expect(injectAssetsMock).toHaveBeenCalledWith(context);
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
