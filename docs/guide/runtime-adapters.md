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

## Existing Express applications

No migration is required. Existing imports and hooks keep working:

```ts
import entryServer from '@lomray/vite-ssr-boost/node/entry';

export default entryServer(App, routes, options);
```

The `node/entry`, `node/server`, and legacy hook paths remain compatibility entrypoints backed by
the Express adapter. Legacy `onRequest` and render hooks receive the same live Express 5 `req` and
`res` objects, so existing headers, cookies, and response takeover keep working. New Fetch handlers
do not emulate Express objects. `onResponse` keeps the same signature and still transforms streamed
HTML. The core decodes split UTF-8 chunks safely before invoking it.

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

## Adapters

Native Node or connect-style:

```ts
import http from 'node:http';
import adapterNode from '@lomray/vite-ssr-boost/adapters/node';

http.createServer(adapterNode(handler)).listen(3000);
```

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

Hono:

```ts
import adapterHono from '@lomray/vite-ssr-boost/adapters/hono';

app.all('*', adapterHono(handler));
```

Cloudflare Workers, Vercel Edge, Deno, or Bun:

```ts
import adapterEdge from '@lomray/vite-ssr-boost/adapters/edge';

export default { fetch: adapterEdge(handler) };
```

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

The adapter negotiates `gzip` or `deflate`, uses the platform `CompressionStream`, preserves
streaming and separate cookies, and skips partial, already encoded, and `no-transform` responses.

## Cookies

Append each cookie independently:

```ts
const headers = new Headers();

headers.append('Set-Cookie', 'session=one; Path=/');
headers.append('Set-Cookie', 'theme=dark; Path=/');
```

Node transports use `headers.getSetCookie()` and emit distinct headers. Never split a
`Set-Cookie` value on commas because an `Expires` attribute contains a comma.
