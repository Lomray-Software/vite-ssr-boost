// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PropsWithChildren } from 'react';
import StreamError from '@constants/stream-error';
import render from '@node/render';

const {
  renderToPipeableStreamMock,
  createStaticRouterMock,
  createFetchRequestMock,
  writeResponseMock,
  injectAssetsMock,
  handleResponseMock,
  obtainStreamErrorMock,
} = vi.hoisted(() => ({
  renderToPipeableStreamMock: vi.fn(),
  createStaticRouterMock: vi.fn(() => ({ router: true })),
  createFetchRequestMock: vi.fn(() => new Request('http://localhost/test')),
  writeResponseMock: vi.fn(),
  injectAssetsMock: vi.fn(),
  handleResponseMock: vi.fn(() => 200),
  obtainStreamErrorMock: vi.fn(() => ({
    code: StreamError.Unknown,
    message: 'broken',
    original: new Error('broken'),
  })),
}));

vi.mock('react-dom/server', () => ({
  renderToPipeableStream: renderToPipeableStreamMock,
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();

  return {
    ...actual,
    createStaticRouter: createStaticRouterMock,
  };
});
vi.mock('@node/create-fetch-request', () => ({ default: createFetchRequestMock }));
vi.mock('@node/write-response', () => ({ default: writeResponseMock }));
vi.mock('@helpers/handle-response', () => ({ default: handleResponseMock }));
vi.mock('@helpers/obtain-stream-error', () => ({ default: obtainStreamErrorMock }));
vi.mock('@services/ssr-manifest', () => ({
  default: {
    get: vi.fn(() => ({
      injectAssets: injectAssetsMock,
    })),
  },
}));

describe('node render', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const createContext = () => {
    const handlers: Record<string, () => void> = {};
    const req = {
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
    };
    const write = vi.fn(() => true);
    const res = {
      write,
      __write: write,
      status: vi.fn(),
      setHeader: vi.fn(),
      send: vi.fn(),
    };
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const config = {
      getLogger: () => logger,
    };
    const context: Record<string, any> = {
      req,
      res,
      appProps: { foo: 'bar' },
      html: { header: '<head></head>', footer: '<body></body>' },
    };
    const handler = {
      query: vi.fn().mockResolvedValue({ basename: '/base', matches: [] }),
      dataRoutes: [],
    };

    return { handlers, req, res, logger, config, context, handler };
  };

  it('should stream response on shell ready', async () => {
    const { context, handler, config, res } = createContext();
    let callbacks!: Parameters<typeof renderToPipeableStreamMock>[1];
    renderToPipeableStreamMock.mockImplementation((_, opts) => {
      callbacks = opts;

      return {
        pipe: vi.fn(),
        abort: vi.fn(),
      };
    });

    await render(
      { App: App as never, handler: handler as never },
      config as never,
      context as never,
      {
        onResponse: ({ html }) => html.replace('a', 'b'),
      },
    );

    callbacks.onShellReady();
    (context.res.write as (chunk: string) => boolean)('a');

    expect(createFetchRequestMock).toHaveBeenCalled();
    expect(handler.query).toHaveBeenCalled();
    expect(injectAssetsMock).toHaveBeenCalledWith(context);
    expect(writeResponseMock).toHaveBeenCalledOnce();
    expect(createStaticRouterMock).toHaveBeenCalled();
    expect(res.__write).toHaveBeenCalledWith('b');
  });

  it('should write on all ready for non-stream rendering', async () => {
    const { context, handler, config } = createContext();
    let callbacks!: Parameters<typeof renderToPipeableStreamMock>[1];
    renderToPipeableStreamMock.mockImplementation((_, opts) => {
      callbacks = opts;

      return {
        pipe: vi.fn(),
        abort: vi.fn(),
      };
    });

    await render(
      { App: App as never, handler: handler as never },
      config as never,
      context as never,
      {
        onRouterReady: () => ({ isStream: false }),
      },
    );

    callbacks.onAllReady();

    expect(writeResponseMock).toHaveBeenCalledOnce();
    expect(context.isStream).toBe(false);
    expect(context.serverContext).toMatchObject({ isServer: true, basename: '/base' });
  });

  it('should stop rendering when router response handled redirect', async () => {
    handleResponseMock.mockReturnValueOnce(undefined as never);
    const { context, handler, config } = createContext();

    await render(
      { App: App as never, handler: handler as never },
      config as never,
      context as never,
      {},
    );

    expect(injectAssetsMock).not.toHaveBeenCalled();
    expect(renderToPipeableStreamMock).not.toHaveBeenCalled();
  });

  it('should handle shell errors and stream errors', async () => {
    const { context, handler, config, logger, handlers, res } = createContext();
    const abort = vi.fn();
    const onError = vi.fn();
    let callbacks!: Parameters<typeof renderToPipeableStreamMock>[1];
    renderToPipeableStreamMock.mockImplementation((_, opts) => {
      callbacks = opts;

      return {
        pipe: vi.fn(),
        abort,
      };
    });

    await render(
      { App: App as never, handler: handler as never },
      config as never,
      context as never,
      {
        onShellError: () => '<html>custom-error</html>',
        onError,
        abortDelay: 1,
      },
    );

    callbacks.onShellError(new Error('boom'));
    callbacks.onError('boom');
    handlers.close?.();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('<html>custom-error</html>');
    expect(onError).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('boom');
    expect(abort).toHaveBeenCalled();
    expect(context.didError).toBe(StreamError.RenderCancel);
  });
});
const App = ({ children }: PropsWithChildren) => children;
