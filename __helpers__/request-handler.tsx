import React from 'react';
import type { RouteObject, StaticHandler } from 'react-router';
import { createStaticHandler } from 'react-router';
import type { Mock, MockInstance } from 'vitest';
import { vi } from 'vitest';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions, IHtmlShell } from '@core/handler';
import type { ICoreRenderParams, IRenderStream, TRenderToStream } from '@core/render';
import type { TSsrHandler } from '@core/types';

interface IStreamRenderer {
  /** Controllable React renderer and stream lifecycle spies. */
  renderToStream: Mock<TRenderToStream>;
  cancel: Mock<() => void>;
  abort: Mock<() => void>;
  end: () => void;
  error: (error: Error) => void;
}

interface IHandlerFixture extends IStreamRenderer {
  /** Real Fetch handler with observed routing, shell and app creation. */
  fetch: TSsrHandler;
  query: MockInstance<StaticHandler['query']>;
  getHtml: Mock<() => IHtmlShell>;
  createApp: Mock<ICoreRenderParams['createApp']>;
}

export const HUMAN =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Construct Fetch requests with a realistic human user agent by default. */
export const documentRequest = (path = '/', init: RequestInit = {}): Request =>
  new Request(`https://example.test${path}`, {
    ...init,
    headers: { 'User-Agent': HUMAN, ...init.headers },
  });

/** A deterministic renderer whose stream can be held, failed or cancelled. */
export const streamRenderer = (isHeld = false): IStreamRenderer => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn<() => void>();
  const abort = vi.fn<() => void>();
  const renderToStream = vi.fn<TRenderToStream>(() => {
    const stream = new ReadableStream<Uint8Array>({
      start: (value) => {
        controller = value;
      },
      cancel,
    });
    const output: IRenderStream = {
      stream,
      abort,
      allReady: Promise.resolve(),
      shellReady: Promise.resolve(),
      start: () => {
        controller.enqueue(new TextEncoder().encode('<p>RENDERED</p>'));
        if (!isHeld) {
          controller.close();
        }
      },
    };
    return output;
  });
  return {
    renderToStream,
    cancel,
    abort,
    end: () => controller.close(),
    error: (error: Error) => controller.error(error),
  };
};

/** Exercise the real core pipeline with controllable React output and real router queries. */
export const handlerFixture = (
  options: Partial<ICreateHandlerOptions<Record<string, any>>> = {},
  routes: RouteObject[] = [
    { path: '/', Component: () => <p>home</p>, ErrorBoundary: () => <p>404</p> },
  ],
  renderer = streamRenderer(),
): IHandlerFixture => {
  const handler = createStaticHandler(routes, { basename: options.basename });
  const query = vi.spyOn(handler, 'query');
  const getHtml = vi.fn(() => ({
    header: '<html><body><div id="root">',
    footer: '</div><script src="/app.js"></script></body></html>',
  }));
  const createApp = vi.fn<ICoreRenderParams['createApp']>((children) => children);
  const fetch = createHandler(
    { handler, createApp, renderToStream: renderer.renderToStream },
    { diagnostics: false, getHtml, ...options },
  );
  return { fetch, query, getHtml, createApp, ...renderer };
};
