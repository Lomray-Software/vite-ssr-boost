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

## Request lifecycle hooks

`init` resolves to a request lifecycle configuration:

```ts
interface IEntrypointOptions<TAppProps> {
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

## `onRequest`

The most important request hook.

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
