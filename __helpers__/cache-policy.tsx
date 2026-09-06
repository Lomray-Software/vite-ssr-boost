import React from 'react';
import { createStaticHandler } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import createHandler from '@core/handler';
import type { TRenderToStream } from '@core/render';
import { cacheControl, copyLoaderHeaders } from '../src/http';
import Diagnostics from '@services/diagnostics';

/** Exercise the actual router, header hooks, renderer and final Fetch response. */
const testCachePolicy = (runtime: string, renderToStream: TRenderToStream) => {
  describe(`${runtime} document policy`, () => {
    it.each([true, false])(
      'protects guest/authenticated responses with streaming=%s',
      async (isStream) => {
        const handler = createHandler(
          {
            createApp: (children) => children,
            handler: createStaticHandler([
              {
                path: '*',
                Component: () => <main>Rendered page</main>,
                loader: () =>
                  Response.json(
                    { ok: true },
                    { headers: { 'Cache-Control': 'public, max-age=100' } },
                  ),
              },
            ]),
            renderToStream,
          },
          {
            diagnostics: false,
            getHtml: () => ({ header: '<!doctype html><div>', footer: '</div>' }),
            sessionCookie: 'session',
            getState: ({ context }) => {
              if (new URL(context.request.url).pathname === '/state-cookie') {
                context.response.headers.append('Set-Cookie', 'state=new');
              }
            },
            documentHeaders: [
              {
                when: () => true,
                set: { 'Cache-Control': cacheControl({ public: true, maxAge: 0, sMaxAge: 30 }) },
              },
            ],
            onRouterReady: ({ context }) => {
              context.response.headers = copyLoaderHeaders(context.routerContext!, {
                allow: ['Cache-Control', 'Content-Type'],
              });
              return { isStream };
            },
            onShellReady: ({ context }) => {
              if (new URL(context.request.url).pathname === '/cookie')
                context.response.headers.append('Set-Cookie', 'session=new');
              return {};
            },
          },
        );
        for (const [path, headers, expected] of [
          ['/guest', {}, 'public, max-age=0, s-maxage=30'],
          ['/guest', { Cookie: 'session=x' }, 'private, no-store'],
          ['/guest', { Authorization: 'Bearer x' }, 'private, no-store'],
          ['/cookie', {}, 'private, no-store'],
          ['/state-cookie', {}, 'private, no-store'],
        ] as const) {
          const response = await handler(new Request(`https://example.test${path}`, { headers }));
          expect(response.headers.get('Cache-Control')).toBe(expected);
          expect(response.headers.get('Content-Type')).toBe('text/html');
          expect(await response.text()).toContain('Rendered page');
        }
      },
    );

    it.each([true, false])(
      'diagnoses a final public override only when enabled=%s',
      async (diagnostics) => {
        const inspect = vi.spyOn(Diagnostics.prototype, 'inspectCachePolicy');
        try {
          const handler = createHandler(
            {
              createApp: (children) => children,
              handler: createStaticHandler([{ path: '*', Component: () => <p>Page</p> }]),
              renderToStream,
            },
            {
              getHtml: () => ({ header: '<div>', footer: '</div>' }),
              diagnostics,
              sessionCookie: 'session',
              protectPrivate: false,
              documentHeaders: [{ when: () => true, set: { 'Cache-Control': 'public' } }],
            },
          );
          const response = await handler(
            new Request(`https://example.test/leak-${runtime}`, {
              headers: { Cookie: 'session=x' },
            }),
          );
          await response.text();
          expect(inspect).toHaveBeenCalledTimes(diagnostics ? 1 : 0);
          if (diagnostics) expect(inspect.mock.calls[0][1]).toBe(true);
        } finally {
          inspect.mockRestore();
        }
      },
    );
  });
};

export default testCachePolicy;
