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

Move your server entry import into the Express adapter:

```ts
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';

export default entryServer(App, routes, options);
```

The old entrypoints are removed in this major release. `onRequest` and render hooks receive the same
live Express 5 `req` and `res` objects, so existing headers, cookies, and response takeover keep working.
New Fetch handlers do not emulate Express objects. `onResponse` keeps the same signature and still
transforms streamed HTML. The core decodes split UTF-8 chunks safely before invoking it.

### Migration notes

See [Upgrade from 7 to 8](/guide/upgrade-v8) for the complete import map, `onResponse` contract, `context.request`, Node requirement and changed error handling.

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
or a `Response` to bypass rendering. These extensionless imports work directly in Node and bundlers;
explicit `.js` imports remain supported.

`createHandler` also accepts `diagnostics?: boolean` in its second argument, alongside `getHtml`.
It defaults to `process.env.NODE_ENV !== 'production'`, or `true` in runtimes without `process`.
`SSR_BOOST_DIAGNOSTICS=0` or `1` overrides the option wherever environment variables are available.
Enabled checks warn once per distinct message about state serialization, shell boundaries and
completed response output; disabled checks do no state walking or HTML accumulation.
See [Development diagnostics](/reference/diagnostics) for the codes and fixes. For file-backed
shells, `loadHtmlShell` validates exactly one outlet in every mode before producing `{ header, footer }`.

## Adapters

The managed CLI is the default path. A custom transport owns the development server and static assets.
For Node production servers, the production helpers supply the HTML shell and matched route assets.
The [custom-server example](https://github.com/Lomray-Software/vite-template/tree/example/custom-server)
demonstrates this integration with the managed CLI in development and Fastify in production.

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

Fastify production launcher (`server/index.mjs`):

The built server in the custom-server example exports `handler` and `configureHandler`. The latter
passes `getHtml` and `prepare` to its Fetch handler before Fastify starts accepting requests.
Run `npm run build` first, then start this launcher with `node server/index.mjs`.

```js
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import adapterFastify from '@lomray/vite-ssr-boost/adapters/fastify';
import { createRouteAssetPreparer, loadHtmlShell } from '@lomray/vite-ssr-boost/node/production';
import Fastify from 'fastify';
import { configureHandler, handler } from '../build/server/server.js';

const buildDir = fileURLToPath(new URL('../build/', import.meta.url));
const clientDir = join(buildDir, 'client');

configureHandler({
  getHtml: await loadHtmlShell({ indexFile: join(clientDir, 'index.html') }),
  prepare: createRouteAssetPreparer({ buildDir }),
});

const app = Fastify();

await app.register(fastifyStatic, {
  root: clientDir,
  index: false,
  wildcard: false,
  immutable: true,
  maxAge: '1y',
  setHeaders: (reply, filePath) => {
    if (!filePath.startsWith(`${join(clientDir, 'assets')}${sep}`)) {
      reply.header('Cache-Control', 'public, max-age=0');
    }
  },
});
app.all('/*', adapterFastify(handler, { compression: true }));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void app.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}

const address = await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });

console.info(`Fastify listening at ${address}`);
```

`loadHtmlShell` reads the built HTML once and returns a fresh shell per request.
`createRouteAssetPreparer` reads `build/server/assets-manifest.json` when a request first matches
routes, caches it for that preparer, and forwards Early Hints through the adapter. Paths resolved
from `import.meta.url` let the launcher start from any working directory. See the
[Node production API](/api/node-production) for options.

Fastify request hooks and their response headers are preserved. The adapter uses `reply.hijack()`
to stream through the raw transport, so Fastify serialization and `onSend` hooks are bypassed.
Use the adapter's compression option for this path.

Hono:

```ts
import adapterHono from '@lomray/vite-ssr-boost/adapters/hono';

app.all('*', adapterHono(handler));
```

### Cloudflare Workers

The managed CLI is the default path for Node/Express applications. A custom Worker transport owns
the development server, static assets and route-asset injection; the
[custom-server example](https://github.com/Lomray-Software/vite-template/tree/example/custom-server)
demonstrates those responsibilities with a Fastify production launcher.

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

The Node adapter streams the original request body. Express and Fastify do the same when
`request.body` is undefined, including untouched multipart uploads. Parsed JSON and flat URL-encoded
fields (including arrays of scalar values) are serialized automatically. For nested URL-encoded
objects or an already consumed custom/multipart body, provide `getBody`:

```ts
app.use(adapterExpress(handler, {
  getBody: (request) => JSON.stringify(request.body),
}));
```

This keeps parser-specific objects out of the core and makes conversion failures explicit.

The managed Express server accepts `getBody` from `init` too. For middleware that already consumed
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

Compression is an adapter concern and never runs in the core. The managed Express server keeps its
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

Loader/action and server `<Navigate>` redirects also preserve headers set by `onRequest` and hooks
that ran before the redirect. Redirect headers override matching hook headers; `Set-Cookie` values
from both are appended separately. For rendered routes,
React Router exposes loader/action headers on `context.routerContext`; copy the headers your HTML
document needs in `onRouterReady`. A JSON loader's `Content-Type` is not the document's content type.

## Streaming and cancellation

Follow the [data-loading contract](/guide/migrate-existing-spa#data-loading) for loader data at first paint and the Suspense pattern used for streamed data.

The default sends the shell as soon as React makes it available. Return `{ isStream: false }`
from `onRouterReady` to wait for the complete tree, for example for crawlers. `onResponse` still
receives chunks in either mode; a chunk is not guaranteed to contain a complete HTML tag.

`abortDelay` limits React rendering, starting after loaders and request hooks finish. Pass
`request.signal` to loader fetches to cancel their work on disconnect. Node, Express and Fastify
stop quietly if a loader rejects after the client disconnects; other handler errors still reach
the framework's error handler. Shell failures return 500;
errors after the shell has been sent keep the committed status and let React recover on the client.
HEAD and 204/205/304 responses have no body. Set redirects and statuses before the shell is sent;
components inside a suspended boundary cannot change headers after that point.
