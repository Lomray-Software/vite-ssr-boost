// @vitest-environment node
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import render from '@core/render';
import type {
  IRenderStream,
  IRenderStreamOptions,
  ISsrRequestContext,
  TRenderToStream,
} from '@core/render';

const createRouter = (queryResult?: Response) => {
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
    statusCode: 200,
  };

  return {
    dataRoutes: [route],
    query: vi.fn(async () => queryResult ?? routerContext),
  };
};

const createRenderer = () => {
  let callbacks!: IRenderStreamOptions;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const abort = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
    },
  });
  const output: IRenderStream = {
    abort,
    start: vi.fn(() => {
      controller.enqueue(new TextEncoder().encode('BODY'));
      controller.close();
    }),
    stream,
  };
  const renderToStream: TRenderToStream = vi.fn((_, options) => {
    callbacks = options;

    return output;
  });

  return {
    abort,
    getCallbacks: () => callbacks,
    output,
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
    renderer.getCallbacks().onShellReady();

    const response = await pending;

    renderer.getCallbacks().onAllReady();

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
    renderer.getCallbacks().onShellReady();
    expect(renderer.output.start).not.toHaveBeenCalled();

    renderer.getCallbacks().onAllReady();

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
    renderer.getCallbacks().onShellError(new Error('broken'));

    const response = await pending;

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('<p>broken</p>');
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

    renderer.getCallbacks().onShellError(new Error('aborted'));
    await pending;
  });
});
