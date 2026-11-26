// @vitest-environment node
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import defineEntry, { isEntry } from '@core/entry';
import renderToStream from '@node/render-to-stream';

const shell = () => ({
  header: '<!doctype html><html><head></head><body><div id="root">',
  footer: '</div></body></html>',
});

/** Render the application props so tests can see what reached the wrapper. */
const App = ({ children, server }: React.PropsWithChildren<{ server: { user?: string } }>) => (
  <main data-user={server.user}>{children}</main>
);

const routes = [
  { id: 'home', path: '/', Component: () => <p>Home</p> },
  { id: 'about', path: '/about', Component: () => <p>About</p> },
];

describe('defineEntry', () => {
  it('marks entries so hosts can tell them apart from other exports', () => {
    const entry = defineEntry(App, routes);

    expect(entry.kind).toBe('ssr-boost-entry');
    expect(isEntry(entry)).toBe(true);
    expect(isEntry({ render: vi.fn() })).toBe(false);
    expect(isEntry(() => undefined)).toBe(false);
    expect(isEntry(null)).toBe(false);
  });

  it('renders through the application wrapper with request props, status and headers', async () => {
    const handler = defineEntry(App, routes, {
      onRequest: () => ({
        appProps: { user: 'guest' },
        status: 202,
        headers: [
          ['Set-Cookie', 'one=1; Path=/'],
          ['Set-Cookie', 'two=2; Path=/'],
        ],
      }),
    })({ getHtml: shell, renderToStream });

    const response = await handler(new Request('http://localhost/about'));
    const body = await response.text();

    expect(response.status).toBe(202);
    expect(response.headers.getSetCookie()).toEqual(['one=1; Path=/', 'two=2; Path=/']);
    expect(body).toContain('<main data-user="guest"><p>About</p></main>');
    expect(body.startsWith('<!doctype html>')).toBe(true);
  });

  it('runs host preparation before the entry hook on the same context', async () => {
    const calls: string[] = [];
    const handler = defineEntry(App, routes, {
      prepare: ({ context }) => {
        calls.push(`entry:${context.html.header.includes('host-asset')}`);
      },
    })({
      getHtml: shell,
      renderToStream,
      prepare: ({ context }) => {
        calls.push('host');
        context.html.header = context.html.header.replace(
          '</head>',
          '<link rel="stylesheet" href="/host-asset.css"></head>',
        );
      },
    });

    const body = await (await handler(new Request('http://localhost/'))).text();

    expect(calls).toEqual(['host', 'entry:true']);
    expect(body).toContain('href="/host-asset.css"');
  });

  it('returns a Response from onRequest without loading the document', async () => {
    const getHtml = vi.fn(shell);
    const handler = defineEntry(App, routes, {
      onRequest: () => new Response('moved', { status: 302, headers: { Location: '/' } }),
    })({ getHtml, renderToStream });

    const response = await handler(new Request('http://localhost/about'));

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/');
    expect(getHtml).not.toHaveBeenCalled();
  });

  it('matches routes under the router basename', async () => {
    const handler = defineEntry(App, routes, { routerOptions: { basename: '/app' } })({
      getHtml: shell,
      renderToStream,
    });

    const response = await handler(new Request('http://localhost/app/about'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<p>About</p>');
  });

  it('shares runtime state between hosts mounting the same entry', async () => {
    const onRequest = vi.fn(() => ({}));
    const entry = defineEntry(App, [{ id: 'root', path: '/', errorElement: <p>missing</p> }], {
      notFound: 'cached',
      onRequest,
    });
    const first = entry({ getHtml: shell, renderToStream });
    const second = entry({ getHtml: shell, renderToStream });

    const responses = [
      await first(new Request('http://localhost/one')),
      await second(new Request('http://localhost/two')),
    ];

    expect(responses.map(({ status }) => status)).toEqual([404, 404]);
    await Promise.all(responses.map((response) => response.text()));
    expect(onRequest).toHaveBeenCalledOnce();
  });
});
