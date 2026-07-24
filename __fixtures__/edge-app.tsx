import React from 'react';
import { createStaticHandler } from 'react-router';
import adapterEdge from '../src/adapters/edge';
import createHandler from '../src/core/handler';
import renderToStream from '../src/edge/render-to-stream';

const handler = createHandler(
  {
    createApp: (children) => children,
    handler: createStaticHandler([
      {
        Component: () => <main>Edge runtime</main>,
        path: '*',
      },
    ]),
    renderToStream,
  },
  {
    getHtml: () => ({
      footer: '</div></body></html>',
      header: '<!doctype html><html><body><div id="root">',
    }),
    onRequest: () => {
      const headers = new Headers();

      headers.append('Set-Cookie', 'one=1; Path=/');
      headers.append('Set-Cookie', 'two=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/');

      return { headers, status: 202 };
    },
  },
);
const fetchHandler = adapterEdge(handler, { compression: true });

export default {
  fetch: async (request: Request) => {
    const response = await fetchHandler(request);

    if (new URL(request.url).searchParams.has('inspect-compression')) {
      const encoding = response.headers.get('Content-Encoding') as 'deflate' | 'gzip' | null;
      const html = encoding
        ? await new Response(
            response.body!.pipeThrough(new DecompressionStream(encoding)),
          ).text()
        : await response.text();

      return Response.json({
        cookies: response.headers.getSetCookie(),
        encoding,
        html,
        vary: response.headers.get('Vary'),
      });
    }

    return response;
  },
};
