// @vitest-environment node
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StreamError from '@constants/stream-error';
import render from '@node/render';

const { coreRenderMock, createFetchRequestMock, injectAssetsMock, writeFetchResponseMock } =
  vi.hoisted(() => ({
    coreRenderMock: vi.fn(),
    createFetchRequestMock: vi.fn(() => new Request('http://localhost/test')),
    injectAssetsMock: vi.fn(),
    writeFetchResponseMock: vi.fn(),
  }));

vi.mock('@core/render', () => ({ default: coreRenderMock }));
vi.mock('@node/create-fetch-request', () => ({ default: createFetchRequestMock }));
vi.mock('@node/write-fetch-response', () => ({ default: writeFetchResponseMock }));
vi.mock('@services/ssr-manifest', () => ({
  default: {
    get: vi.fn(() => ({
      injectAssets: injectAssetsMock,
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
    };
    const config = {
      getLogger: () => logger,
    };
    const context: Record<string, any> = {
      appProps: { value: 'app' },
      html: { footer: '</html>', header: '<html>' },
      req: { off: vi.fn(), once: vi.fn(), request: true },
      res,
    };

    return { config, context, logger, res };
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps legacy hooks to the Fetch core and writes its Response', async () => {
    const { config, context } = createContext();
    const onError = vi.fn();
    const onResponse = vi.fn(({ html }) => html);
    const onRouterReady = vi.fn(() => ({ isStream: true }));
    const onShellReady = vi.fn(() => ({ header: '<head>' }));
    const getState = vi.fn(() => ({ app: { value: 1 } }));
    const response = new Response('rendered');

    coreRenderMock.mockImplementation(async (_, coreContext, options) => {
      coreContext.routerContext = { basename: '/base' };
      coreContext.serverContext = { isServer: true, response: null };
      await options.prepare({ context: coreContext });
      await options.onRouterReady({ context: coreContext });
      options.onShellReady({ context: coreContext });
      options.onResponse({ context: coreContext, html: 'chunk' });
      options.getState({ context: coreContext });
      options.onError({
        context: coreContext,
        error: {
          code: StreamError.Unknown,
          message: 'broken',
          original: new Error('broken'),
        },
      });

      return response;
    });

    await render(
      { App: App as never, handler: { handler: true } as never },
      config as never,
      context as never,
      {
        getState,
        onError,
        onResponse,
        onRouterReady,
        onShellReady,
      },
    );

    expect(createFetchRequestMock).toHaveBeenCalledWith(context.req, {
      signal: expect.any(AbortSignal),
    });
    expect(injectAssetsMock).toHaveBeenCalledWith(context);
    expect(onRouterReady).toHaveBeenCalledWith({ context });
    expect(onShellReady).toHaveBeenCalledWith({ context });
    expect(onResponse).toHaveBeenCalledWith({ context, html: 'chunk' });
    expect(getState).toHaveBeenCalledWith({ context });
    expect(onError).toHaveBeenCalledWith({
      context,
      error: expect.objectContaining({ code: StreamError.Unknown }),
    });
    expect(writeFetchResponseMock).toHaveBeenCalledWith(context.res, response);
  });

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
});
