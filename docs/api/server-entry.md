# Server Entry

## Import

```ts
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';
```

## Signature

```ts
entryServer(App, routes, options?)
```

Options:

```ts
interface IEntryServerOptions<TAppProps> {
  ssr?: ISsrPolicy;
  abortDelay?: number;
  init?: (params: { config: ServerConfig }) =>
    IEntrypointOptions<TAppProps> | Promise<IEntrypointOptions<TAppProps>>;
  loggerProd?: Logger;
  loggerDev?: Logger;
  middlewares?: {
    compression?: CompressionOptions | false;
    expressStatic?: (ServeStaticOptions & { basename?: string }) | false;
  };
  routerOptions?: Parameters<typeof createStaticHandler>[1];
}
```

## What it returns

The entry returns a render definition consumed by the runtime server. It includes:

- `render`
- `init`
- `routes`
- `abortDelay`
- optional loggers
- optional middleware config

## `ssr`

Select SSR or the SPA shell per incoming URL, before route loaders run:

```ts
interface ISsrPolicy {
  mode?: 'all' | 'include' | 'exclude';
  routes?: (string | RegExp)[];
  bots?: 'ssr' | 'policy';
  decide?: (params: { request: Request; url: URL; isBot: boolean }) =>
    'ssr' | 'spa' | undefined;
}

entryServer(App, routes, {
  ssr: { mode: 'include', routes: ['/', '/articles/:slug'] },
});
```

`all` is the default. `include` uses SSR only for matching URL pathnames; `exclude` serves matches as SPA. Strings use path-to-regexp 8 syntax, including named wildcards and brace optional groups; RegExp patterns use their own flags. Include the router basename in patterns. `decide` overrides the configured mode per request, with `undefined` falling back to the route policy. `bots: 'ssr'` defaults to forcing detected crawlers to SSR ahead of all other decisions; use `'policy'` to opt out.

At entry creation, `SSR_BOOST_SSR_ROUTES` overrides `mode`, `routes` and `decide`, preserving `bots`. Comma-separated positive patterns form an include list; `!` patterns exclude URLs and win over includes. With only exclusions, other URLs stay SSR. An empty value selects SSR everywhere. Restart after changes; no rebuild is needed.

SPA responses retain `onRequest` and route asset preparation, use status 200 and the `data-force-spa` mount marker, and omit router/custom state and SSR render hooks. Active policies default documents to `Cache-Control: no-store` unless `onRequest` supplies a cache policy. The same `ssr` option is available on Fetch `createHandler`. See [Incremental SSR](/guide/incremental-ssr) for the full reference, lifecycle trade-offs and rollback recipe.

## Request lifecycle hooks

`init` resolves to a request lifecycle configuration:

```ts
interface IEntrypointOptions<TAppProps> {
  hydration?: 'footer' | 'early';
  nonce?: string;
  bootstrapScriptContent?: string;
  onServerCreated?;
  onServerStarted?;
  onRequest?;
  onRouterReady?;
  onShellReady?;
  onShellError?;
  onResponse?;
  onError?;
  getState?;
}
```

See [Server Lifecycle](/guide/server-lifecycle) for the flow and intent of each hook.

## Hook context

`onRouterReady`, `onShellReady`, `onShellError`, `onError`, `onResponse` and `getState`
receive `{ context }`, with these fields:

- `request`: the Fetch `Request` built from the Express request; use it for headers, URL and method so hooks stay portable to other adapters.
- `response`: mutable Fetch `headers` and optional `status`; update these before the shell is sent.
- `req` / `res`: the live Express request and response, [deprecated in 8.x](/guide/upgrade-v8#deprecated-in-8-x) with removal planned for 9.0.
- `appProps`: request-scoped props returned by `onRequest`.
- `html`: the template `header` and `footer`.
- `routerContext` / `serverContext`: router and SSR metadata, once available.
- `isStream`, `hasEarlyHints` and `didError`: rendering mode, early-hints preference and error metadata.

`request` is the same object used by the Fetch core throughout a render; its `signal` tracks request cancellation.

```ts
onRouterReady: ({ context: { request } }) => ({
  isStream: !request.headers.get('user-agent')?.includes('Googlebot'),
}),
```

## `onRequest`

The most important request hook.

It receives `(req, res)` before the render context is created.

It can return:

```ts
{
  appProps?: TAppProps;
  hasEarlyHints?: boolean;
  shouldSkip?: boolean;
  shouldCancel?: boolean;
}
```

That lets you shape app props, skip a request, or stop the rendering path entirely.

## `onResponse`

```ts
onResponse?: (params: {
  context: IRequestContext<TAppProps>;
  html: string;
  isEnd: boolean;
}) => string | undefined | void;
```

Regular HTML chunks arrive with `isEnd: false`. Returning `undefined` (or nothing) keeps the
original chunk; a string replaces it. Returning `''` withholds the chunk, allowing an
incremental transform to retain unfinished tokens.

After the composed body stream finishes, including the footer, the hook receives one final
call with `html: ''` and `isEnd: true`. Its returned string is appended to the response;
`undefined` or `''` appends nothing. This also applies to buffered rendering (`isStream: false`).
Hooks that ignore `isEnd` remain supported.

For example, using `@lomray/consistent-suspense`:

```ts
onResponse: ({ context: { appProps: { streamSuspense }, isStream }, html, isEnd }) => {
  if (!isStream) return;
  return isEnd ? streamSuspense.end() : streamSuspense.analyze(html);
},
```

## Middleware config

Production middleware can be configured without replacing the whole server pipeline:

```ts
export default entryServer(App, routes, {
  middlewares: {
    compression: {},
    expressStatic: {
      basename: '/static',
    },
  },
});
```

Set either option to `false` when you want it disabled.

## Logging

Use `loggerProd` and `loggerDev` to provide custom Vite-compatible loggers instead of the package default logger.
