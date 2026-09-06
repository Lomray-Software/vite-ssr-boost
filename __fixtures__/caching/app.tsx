import createHandler from '@lomray/vite-ssr-boost/core/handler';
import type { TRenderToStream } from '@lomray/vite-ssr-boost/core/render';
import { copyLoaderHeaders } from '@lomray/vite-ssr-boost/http';
import React from 'react';
import { createStaticHandler, useLoaderData } from 'react-router';
import { rules, sessionCookie } from './policy';

const Page = () => <main>{useLoaderData<{ message: string }>().message}</main>;

/** A complete server-rendered example; wire real authentication into the loader. */
export const createPageHandler = (renderToStream: TRenderToStream) =>
  createHandler(
    {
      createApp: (children) => children,
      handler: createStaticHandler([
        {
          path: '*',
          Component: Page,
          loader: ({ request }) => {
            const authenticated =
              request.headers.has('Authorization') ||
              /(?:^|;)\s*session\s*=/.test(request.headers.get('Cookie') ?? '');

            return Response.json({ message: authenticated ? 'Account page' : 'Guest page' });
          },
        },
      ]),
      renderToStream,
    },
    {
      getHtml: () => ({
        header: '<!doctype html><html><body><div id="root">',
        footer: '</div></body></html>',
      }),
      sessionCookie,
      documentHeaders: rules,
      onRouterReady: ({ context }) => {
        const copied = copyLoaderHeaders(context.routerContext!, {
          allow: ['Cache-Control', 'Set-Cookie'],
        });

        // Preserve existing hook metadata and independent cookies.
        copied.forEach((value, name) => {
          if (name !== 'set-cookie') context.response.headers.set(name, value);
        });
        copied
          .getSetCookie()
          .forEach((cookie) => context.response.headers.append('Set-Cookie', cookie));

        return {};
      },
    },
  );
