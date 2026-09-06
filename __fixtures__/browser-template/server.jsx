import { createStaticHandler } from 'react-router';
import createHandler from '@lomray/vite-ssr-boost/core/handler';
import renderToStream from '@lomray/vite-ssr-boost/node/render-to-stream';
import { cacheControl } from '@lomray/vite-ssr-boost/http';
import { App, routes } from './routes.jsx';
import React from 'react';

/** Build both hydration modes for browser coverage of router state. */
const createRequestHandler = (html, hydration) =>
  createHandler(
    {
      handler: createStaticHandler(routes),
      createApp: (children) => <App>{children}</App>,
      renderToStream,
    },
    {
      hydration,
      ssr: { mode: 'exclude', routes: ['/spa', '/spa-redirect'] },
      diagnostics: false,
      getHtml: () => html,
      getState: () => ({ custom: { ready: true } }),
      sessionCookie: 'session',
      documentHeaders: [{ when: () => true, set: { 'Cache-Control': cacheControl({ public: true, maxAge: 0, sMaxAge: 30 }) } }],
    },
  );

/** Use footer hydration on the page without route data and early hydration elsewhere. */
export const handler = (html) => {
  const footer = createRequestHandler(html, 'footer');
  const early = createRequestHandler(html, 'early');

  return (request) => (new URL(request.url).pathname === '/footer' ? footer : early)(request);
};
