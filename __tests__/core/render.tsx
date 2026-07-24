// @vitest-environment node
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import render from '@core/render';
import type { IRenderStream, ISsrRequestContext, TRenderToStream } from '@core/render';

const createRouter = (queryResult?: Response, statusCode = 200) => {
  const route = {
    Component: () => null,
    id: 'root',
    path: '/',
  };
  const routerContext = {
    actionData: null,
    actionHeaders: {},
    basename: '/',
    errors: null,
    loaderData: { root: null },
    loaderHeaders: {},
    location: {
      hash: '',
      key: 'default',
      pathname: '/',
      search: '',
      state: null,
    },
    matches: [
      {
        params: {},
        pathname: '/',
        pathnameBase: '/',
        route,
      },
    ],
    statusCode,
  };

  return {
    dataRoutes: [route],
    query: vi.fn(async () => queryResult ?? routerContext),
  };
};

const createRenderer = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let onError!: (error: unknown) => void;
  let rejectAll!: (error: Error) => void;
  let rejectShell!: (error: Error) => void;
  let resolveAll!: () => void;
  let resolveShell!: () => void;
  const abort = vi.fn();
  const allReady = new Promise<void>((resolve, reject) => {
    rejectAll = reject;
    resolveAll = resolve;
  });
  const shellReady = new Promise<void>((resolve, reject) => {
    rejectShell = reject;
    resolveShell = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
    },
  });
  const output: IRenderStream = {
    allReady,
    abort,
    shellReady,
    start: vi.fn(() => {
      controller.enqueue(new TextEncoder().encode('BODY'));
      controller.close();
    }),
    stream,
  };
  const renderToStream: TRenderToStream = vi.fn((_, options) => {
    onError = options.onError;

    return output;
  });

  return {
    abort,
    allReady: resolveAll,
    onError: (error: unknown) => onError(error),
    output,
    shellError: (error: Error) => {
      rejectAll(error);
      rejectShell(error);
    },
    shellReady: resolveShell,
    renderToStream,
  };
};

const createContext = (request = new Request('http://localhost/')): ISsrRequestContext => ({
  appProps: {},
  html: {
    footer: '-FOOTER',
    header: 'HEADER-',
  },
  request,
  response: {
    headers: new Headers(),
  },
});

const createApp = (children: ReactNode): ReactNode => children;

describe('core render', () => {
  it('returns a transformed streaming Response on shell ready', async () => {
    const renderer = createRenderer();
    const context = createContext();
    const pending = render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream: renderer.renderToStream,
      },
      context,
      {
        getState: () => ({ app: { ready: true } }),
        onResponse: ({ html }) => html.replace('BODY', 'CHANGED'),
      },
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    renderer.shellReady();

    const response = await pending;

    renderer.allReady();

    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html');
    expect(renderer.output.start).toHaveBeenCalledOnce();
    expect(html).toContain('HEADER-CHANGED');
    expect(html).toContain('window.__staticRouterHydrationData');
    expect(html).toContain('window.app');
    expect(html).toContain('-FOOTER');
  });

  it('waits for all content when streaming is disabled', async () => {
    const renderer = createRenderer();
    const pending = render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream: renderer.renderToStream,
      },
      createContext(),
      {
        onRouterReady: () => ({ isStream: false }),
      },
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    renderer.shellReady();
    expect(renderer.output.start).not.toHaveBeenCalled();

    renderer.allReady();

    await expect(pending).resolves.toBeInstanceOf(Response);
    expect(renderer.output.start).toHaveBeenCalledOnce();
  });

  it('returns redirects without starting React rendering', async () => {
    const renderer = createRenderer();
    const redirect = new Response(null, {
      headers: { Location: '/next' },
      status: 302,
    });

    await expect(
      render(
        {
          createApp,
          handler: createRouter(redirect) as never,
          renderToStream: renderer.renderToStream,
        },
        createContext(),
        {},
      ),
    ).resolves.toBe(redirect);
    expect(renderer.renderToStream).not.toHaveBeenCalled();
  });

  it('returns 500 when React fails before the shell', async () => {
    const renderer = createRenderer();
    const pending = render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream: renderer.renderToStream,
      },
      createContext(),
      {
        onShellError: ({ error }) => `<p>${error.message}</p>`,
      },
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    renderer.shellError(new Error('broken'));

    const response = await pending;

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('<p>broken</p>');
    expect(renderer.output.start).not.toHaveBeenCalled();
  });

  it('returns 500 when the renderer fails before returning a stream', async () => {
    const response = await render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream: async () => {
          throw new Error('renderer failed');
        },
      },
      createContext(),
      {
        onShellError: ({ error }) => `<p>${error.message}</p>`,
      },
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('<p>renderer failed</p>');
  });

  it('uses the React Router status when no hook overrides it', async () => {
    const renderer = createRenderer();
    const pending = render(
      {
        createApp,
        handler: createRouter(undefined, 404) as never,
        renderToStream: renderer.renderToStream,
      },
      createContext(),
      {},
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    renderer.shellReady();

    const response = await pending;

    renderer.allReady();
    expect(response.status).toBe(404);
  });

  it.each([204, 205, 304])('returns no body for status %s', async (status) => {
    const renderer = createRenderer();
    const pending = render(
      {
        createApp,
        handler: createRouter(undefined, status) as never,
        renderToStream: renderer.renderToStream,
      },
      createContext(),
      {},
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    renderer.shellReady();

    const response = await pending;

    expect(response.status).toBe(status);
    expect(response.body).toBeNull();
    expect(renderer.abort).toHaveBeenCalledOnce();
    expect(renderer.output.start).not.toHaveBeenCalled();
  });

  it('returns no body for HEAD', async () => {
    const renderer = createRenderer();
    const pending = render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream: renderer.renderToStream,
      },
      createContext(new Request('http://localhost/', { method: 'HEAD' })),
      {},
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    renderer.shellReady();

    const response = await pending;

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(renderer.abort).toHaveBeenCalledOnce();
    expect(renderer.output.start).not.toHaveBeenCalled();
  });

  it('aborts rendering through request.signal', async () => {
    const controller = new AbortController();
    const renderer = createRenderer();
    const pending = render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream: renderer.renderToStream,
      },
      createContext(new Request('http://localhost/', { signal: controller.signal })),
      {},
    );

    await vi.waitFor(() => expect(renderer.renderToStream).toHaveBeenCalledOnce());
    controller.abort('client closed');

    expect(renderer.abort).toHaveBeenCalledWith('client closed');

    renderer.shellError(new Error('aborted'));
    await pending;
  });

  it('applies abortDelay while an async renderer is waiting for the shell', async () => {
    const abort = vi.fn();
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const renderToStream: TRenderToStream = vi.fn(
      (_, { onError, signal }) =>
        new Promise<IRenderStream>((resolve) => {
          resolveStarted();
          onError(new Error('recoverable'));
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('render timed out');
              const failed = Promise.reject(error);

              void failed.catch(() => undefined);
              resolve({
                abort,
                allReady: failed,
                shellReady: failed,
                start: vi.fn(),
                stream: new ReadableStream<Uint8Array>(),
              });
            },
            { once: true },
          );
        }),
    );
    const context = createContext();
    const pending = render(
      {
        createApp,
        handler: createRouter() as never,
        renderToStream,
      },
      context,
      {
        abortDelay: 10,
        onShellError: ({ error }) => `<p>${error.message}</p>`,
      },
    );

    await started;

    const response = await pending;

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('<p>render timed out</p>');
    expect(context.didError).toBe('timeout');
    expect(abort).toHaveBeenCalledOnce();
  });
});
