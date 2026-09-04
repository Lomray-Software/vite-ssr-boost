# Runtime adapters

The SSR core speaks the Fetch standard:

```ts
type SsrHandler = (
  request: Request,
  context?: SsrExecutionContext,
) => Promise<Response>;
```

`SsrExecutionContext` is optional and only carries capabilities that cannot fit in a final
`Response`, currently `onEarlyHints`.

Choose the managed CLI server for Vite development, HMR, asset manifests and production static
files. It still uses Express. Choose a Fetch handler when your application or hosting platform
owns the HTTP server, bundling and asset delivery; an adapter does not replace the CLI build pipeline.

## Existing Express applications

Existing imports and hooks keep working:

```ts
import entryServer from '@lomray/vite-ssr-boost/node/entry';

export default entryServer(App, routes, options);
```

The `node/entry`, `node/server`, and legacy hook paths remain compatibility entrypoints backed by
the Express adapter. Legacy `onRequest` and render hooks receive the same live Express 5 `req` and
`res` objects, so existing headers, cookies, and response takeover keep working. New Fetch handlers
do not emulate Express objects. `onResponse` keeps the same signature and still transforms streamed
HTML. The core decodes split UTF-8 chunks safely before invoking it.

### Migration notes

- The default shell-error page returns a generic HTTP 500 without exception messages. Use `onError`
  for diagnostics or `onShellError` for a custom page.
- Request/render hook failures reach Express error middleware through `next(error)`, rather than
  falling through to a 404. Register error middleware after the SSR handler.
- Unless explicitly overridden, rendered responses use React Router's status, including 404 for
  unmatched routes. Previously these could be sent as 200.
- Render timeouts and client/intentional cancellation report `onError` codes `timeout` and `cancel`.
  The legacy logger keeps these at info level. Unexpected errors still retain their original error.
- Parsed JSON and URL-encoded bodies work automatically. An unsupported custom or multipart parser
  now fails explicitly instead of sending `[object Object]`; use `getBody` as shown below.

Express and compression are optional dependencies installed by default. If your install command
uses `--omit=optional`, install them explicitly:

```bash
npm i express compression
```

## Create a Fetch handler

```tsx
import createHandler from '@lomray/vite-ssr-boost/core/handler';
import renderToStream from '@lomray/vite-ssr-boost/node/render-to-stream';
import { createStaticHandler } from 'react-router';

const handler = createHandler(
  {
    createApp: (children) => <App>{children}</App>,
    handler: createStaticHandler(routes),
    renderToStream,
  },
  {
    getHtml: () => ({
      header: '<!doctype html><div id="root">',
      footer: '</div>',
    }),
  },
);
```

Use `@lomray/vite-ssr-boost/edge/render-to-stream` instead for Web-standard edge runtimes.

This example returns server HTML. For an interactive app, put your built browser entry script in
`footer`, after the closing root element, and serve its JS/CSS assets. The renderer writes escaped
router and `getState` data before that footer so it is available when the browser entry runs.
`getHtml` supplies a fresh shell per request; `onRequest` can return `{ appProps, headers, status }`
or a `Response` to bypass rendering. Runtime imports used directly by Node need the `.js` extension;
Vite and other bundlers resolve the extensionless examples.

## Adapters

Native Node or connect-style:

```ts
import http from 'node:http';
import adapterNode from '@lomray/vite-ssr-boost/adapters/node';

http.createServer(adapterNode(handler)).listen(3000);
```

The Node and Fastify adapters also accept HTTP/2 compatibility requests/responses, including
`:authority`, separate cookies and Early Hints.

Express:

```ts
import adapterExpress from '@lomray/vite-ssr-boost/adapters/express';

app.use(adapterExpress(handler));
```

Fastify:

```ts
import adapterFastify from '@lomray/vite-ssr-boost/adapters/fastify';

app.all('/*', adapterFastify(handler));
```

Fastify request hooks and their response headers are preserved. The adapter uses `reply.hijack()`
to stream through the raw transport, so Fastify serialization and `onSend` hooks are bypassed.
Use the adapter's compression option for this path.

Hono:

```ts
import adapterHono from '@lomray/vite-ssr-boost/adapters/hono';

app.all('*', adapterHono(handler));
```

Cloudflare Workers:

```ts
import adapterEdge from '@lomray/vite-ssr-boost/adapters/edge';

export default { fetch: adapterEdge(handler) };
```

For Bun use `Bun.serve({ fetch: adapterEdge(handler) })`; for Deno use
`Deno.serve(adapterEdge(handler))`. Bundle the edge renderer and supply the platform's static asset
handling. The CLI's `build-vercel` and `--serverless` output remains a Node/Express deployment;
it does not generate a Cloudflare Worker or Vercel Edge bundle.

Keep the target runtime's package resolution conditions enabled. For a custom Cloudflare bundle,
include `workerd` and `worker` conditions so React 19 selects its Worker renderer; the browser-only
renderer requires APIs such as `MessageChannel` that workerd does not provide.

## Request bodies

The Node adapter streams the original request body. Express and Fastify also preserve parsed JSON
and URL-encoded bodies. For a custom parser or multipart upload, provide the explicit `getBody`
adapter option:

```ts
app.use(adapterExpress(handler, {
  getBody: (request) => JSON.stringify(request.body),
}));
```

This keeps parser-specific objects out of the core and makes conversion failures explicit.

The managed/legacy server accepts `getBody` from `init` too. For middleware that already consumed
a multipart body, rebuild the fields/files your router action needs as `FormData`:

```ts
entryServer(App, routes, {
  init: () => ({
    getBody: (req) => {
      const form = new FormData();
      form.append('name', req.body.name);
      return form;
    },
  }),
});
```

Fetch generates the new multipart boundary. Include uploaded files as `Blob` entries when needed;
`req.files` and other parser-specific data are not copied automatically. Returning `null` explicitly
supplies an empty body. The callback is only used for methods that can carry a request body.

## Early Hints

103 Early Hints are emitted out of band because a final `Response` cannot represent an
informational response:

```ts
prepare: async ({ executionContext }) => {
  const hints = new Headers();

  hints.append('Link', '</app.css>; rel=preload; as=style');
  await executionContext?.onEarlyHints?.(hints);
};
```

Node and Fastify feature-detect `writeEarlyHints`. Unsupported runtimes safely ignore the hook.

## Compression

Compression is an adapter concern and never runs in the core. The legacy Express server keeps its
existing `compression` middleware. The new Node, Express, Fastify, and edge adapters can opt into
streaming compression:

```ts
http.createServer(adapterNode(handler, { compression: true }));

app.all('/*', adapterFastify(handler, { compression: true }));

export default {
  fetch: adapterEdge(handler, { compression: true }),
};
```

The adapters negotiate `gzip` or `deflate`, preserve separate cookies, and skip partial, already
encoded, and `no-transform` responses. Node transports flush compressed HTML incrementally, so
the browser receives the shell before Suspense finishes. Edge compression uses `CompressionStream`,
whose buffering depends on the runtime; leave it off when the hosting platform handles compression.

## Cookies

Append each cookie independently:

```ts
const headers = new Headers();

headers.append('Set-Cookie', 'session=one; Path=/');
headers.append('Set-Cookie', 'theme=dark; Path=/');
```

Node transports use `headers.getSetCookie()` and emit distinct headers. Never split a
`Set-Cookie` value on commas because an `Expires` attribute contains a comma.

Loader/action redirects preserve their `Response` headers, including cookies. For rendered routes,
React Router exposes loader/action headers on `context.routerContext`; copy the headers your HTML
document needs in `onRouterReady`. A JSON loader's `Content-Type` is not the document's content type.

## Streaming and cancellation

The default sends the shell as soon as React makes it available. Return `{ isStream: false }`
from `onRouterReady` to wait for the complete tree, for example for crawlers. `onResponse` still
receives chunks in either mode; a chunk is not guaranteed to contain a complete HTML tag.

`abortDelay` limits React rendering, starting after loaders and request hooks finish. Pass
`request.signal` to loader fetches to cancel their work on disconnect. Shell failures return 500;
errors after the shell has been sent keep the committed status and let React recover on the client.
HEAD and 204/205/304 responses have no body. Set redirects and statuses before the shell is sent;
components inside a suspended boundary cannot change headers after that point.
