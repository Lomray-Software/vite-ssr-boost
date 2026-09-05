import React, { Suspense } from 'react';
import { createStaticHandler } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import Navigate from '@components/navigate';
import StreamError from '@constants/stream-error';
import createHandler from '@core/handler';
import type { ICreateHandlerOptions } from '@core/handler';
import type { TRenderToStream } from '@core/render';

const pending = new Promise<never>(() => undefined);
const Pending = (): never => {
  throw pending;
};
const Page = () => (
  <Suspense fallback={<p>loading</p>}>
    <Pending />
  </Suspense>
);

const fixture = (
  renderToStream: TRenderToStream,
  options: Partial<ICreateHandlerOptions<Record<string, any>>> = {},
  root = false,
) => {
  const onError = vi.fn();
  const handler = createHandler(
    {
      createApp: (children) => (root ? <Pending /> : children),
      handler: createStaticHandler([
        { Component: Page, path: '/' },
        {
          Component: () => (
            <>
              <Navigate to="/next" />
              <Page />
            </>
          ),
          path: '/redirect',
        },
      ]),
      renderToStream,
    },
    {
      abortDelay: 50,
      getHtml: () => ({ header: '<html><body>', footer: '</body></html>' }),
      onError,
      ...options,
    },
  );

  return { handler, onError };
};

const testReactCancellation = (renderer: TRenderToStream): void => {
  describe('real React cancellation', () => {
    it('reports timeout, without unknown errors, after a suspended shell', async () => {
      const { handler, onError } = fixture(renderer);
      const response = await handler(new Request('http://example.com/'));

      expect(await response.text()).toContain('</html>');
      expect(onError).toHaveBeenCalled();
      expect(
        onError.mock.calls.every(
          ([{ error, context }]) =>
            error.code === StreamError.RenderTimeout &&
            context.didError === StreamError.RenderTimeout,
        ),
      ).toBe(true);
    });

    it.each(
      [false, true].flatMap((diagnostics) =>
        [false, true].flatMap((withHook) =>
          [undefined, new Error('client disconnected')].map((reason) => ({
            diagnostics,
            withHook,
            reason,
          })),
        ),
      ),
    )(
      'reports cancellation with reason $reason, diagnostics=$diagnostics, onResponse=$withHook',
      async ({ diagnostics, withHook, reason }) => {
        const controller = new AbortController();
        const { handler, onError } = fixture(renderer, {
          abortDelay: 5_000,
          diagnostics,
          onResponse: withHook ? ({ html }) => html : undefined,
        });
        const response = await handler(
          new Request('http://example.com/', { signal: controller.signal }),
        );
        const reader = response.body!.getReader();

        await reader.read();
        controller.abort(reason);
        await reader.cancel();

        expect(onError.mock.calls.map(([{ error }]) => error)).toEqual([
          {
            code: StreamError.RenderCancel,
            message: controller.signal.reason.message,
            original: controller.signal.reason,
          },
        ]);
        expect(onError.mock.calls[0][0].error.original).toBe(controller.signal.reason);
      },
    );

    it.each([true, false])(
      'settles a timeout before the shell, isStream=%s',
      async (isStream) => {
        const { handler } = fixture(renderer, { onRouterReady: () => ({ isStream }) }, true);
        const response = await handler(new Request('http://example.com/'));

        expect(response.status).toBe(500);
        expect(await response.text()).toContain('Internal Server Error');
      },
      1_000,
    );

    it('rejects both readiness promises for an already-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      const output = await renderer(<Pending />, { signal: controller.signal, onError: vi.fn() });

      try {
        await expect(output.shellReady).rejects.toMatchObject({ name: 'AbortError' });
        await expect(output.allReady).rejects.toMatchObject({ name: 'AbortError' });
      } finally {
        await output.stream.cancel().catch(() => undefined);
      }
    }, 1_000);

    it('settles when the client disconnects after routing but before rendering', async () => {
      const controller = new AbortController();
      const { handler } = fixture(renderer, { prepare: () => controller.abort() }, true);
      const response = await handler(
        new Request('http://example.com/', { signal: controller.signal }),
      );

      expect(response.status).toBe(500);
      await response.text();
    }, 1_000);

    it.each([
      ['HEAD', '/', 200],
      ['GET', '/redirect', 301],
    ] as const)('classifies intentional %s %s cancellation', async (method, path, status) => {
      const { handler, onError } = fixture(renderer);
      const response = await handler(new Request(`http://example.com${path}`, { method }));

      expect(response.status).toBe(status);
      await response.text();
      expect(onError).toHaveBeenCalled();
      expect(
        onError.mock.calls.every(([{ error }]) => error.code === StreamError.RenderCancel),
      ).toBe(true);
    });
  });
};

export default testReactCancellation;
