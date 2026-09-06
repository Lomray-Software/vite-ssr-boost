import { createStaticHandler } from 'react-router';
import createHandler from '@lomray/vite-ssr-boost/core/handler';
import renderToStream from '@lomray/vite-ssr-boost/node/render-to-stream';
import { App, routes } from './routes.jsx';
import React from 'react';
export const handler = (html) =>
  createHandler(
    {
      handler: createStaticHandler(routes),
      createApp: (children) => <App>{children}</App>,
      renderToStream,
    },
    {
      hydration: 'early',
      diagnostics: false,
      getHtml: () => html,
      getState: () => ({ custom: { ready: true } }),
    },
  );
