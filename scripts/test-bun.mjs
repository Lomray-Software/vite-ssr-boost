import assert from 'node:assert/strict';
import React from 'react';
import { createStaticHandler, redirect } from 'react-router';
import adapterEdge from '../lib/adapters/edge.js';
import createHandler from '../lib/core/handler.js';
import renderToStream from '../lib/edge/render-to-stream.js';

const handler = createHandler(
  {
    createApp: (children) => children,
    handler: createStaticHandler([
      { path: '/redirect', loader: () => redirect('/', 303) },
      { path: '*', Component: () => React.createElement('main', null, 'Bun SSR works') },
    ]),
    renderToStream,
  },
  {
    getHtml: () => ({ header: '<!doctype html><div>', footer: '</div>' }),
    onRequest: async ({ request }) => {
      if (request.method === 'POST') return new Response(await request.text());
      const headers = new Headers();
      headers.append('Set-Cookie', 'one=1; Path=/');
      headers.append('Set-Cookie', 'two=2; Path=/');
      return { headers };
    },
  },
);
const server = Bun.serve({ port: 0, fetch: adapterEdge(handler) });

try {
  const response = await fetch(server.url);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.match(html, /<main>Bun SSR works<\/main>/);
  assert.match(html, /window\.__staticRouterHydrationData/);
  assert.ok(html.endsWith('</div>'));
  const head = await fetch(server.url, { method: 'HEAD' });
  assert.equal(await head.text(), '');
  const redirected = await fetch(new URL('/redirect', server.url), { redirect: 'manual' });
  assert.equal(redirected.status, 303);
  assert.equal(redirected.headers.get('location'), '/');
  const posted = await fetch(server.url, { method: 'POST', body: 'payload' });
  assert.equal(await posted.text(), 'payload');
  console.info(`Bun ${Bun.version}: built Fetch SSR, cookies, HEAD, redirects and POST passed`);
} finally {
  server.stop(true);
}
