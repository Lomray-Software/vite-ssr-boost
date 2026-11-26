# Node production helpers

Use these helpers when your application owns its Node HTTP server and serves a build produced by
the SSR BOOST CLI. `createProductionServer` is a complete `node:http` server; `prepareProduction`
gives you the pieces to mount on your own; `loadHtmlShell` and `createRouteAssetPreparer` supply
the `getHtml` and `prepare` options for `core/handler`.

```ts
import {
  createLifecycle,
  createProductionServer,
  createRouteAssetPreparer,
  loadHtmlShell,
  prepareProduction,
  serveStatic,
} from '@lomray/vite-ssr-boost/node/production';
import type {
  ICreateProductionServerOptions,
  IHtmlShell,
  ILifecycle,
  ILifecycleOptions,
  ILoadHtmlShellOptions,
  IPrepareProductionOptions,
  IProductionApp,
  IProductionPaths,
  IProductionServer,
  IRouteAssetPreparerOptions,
  IServeStaticOptions,
  TRouteAssetsManifest,
  TStaticMiddleware,
} from '@lomray/vite-ssr-boost/node/production';
```

The explicit `.js` import path also works. These helpers use Node's filesystem APIs and need
neither Vite nor Express.

## `createProductionServer`

```ts
interface ICreateProductionServerOptions extends IPrepareProductionOptions, ILifecycleOptions {
  compression?: boolean | { format?: 'gzip' | 'deflate' }; // Default: false
  https?: https.ServerOptions;
  logger?: IErrorLogger;
}

interface IProductionServer extends IProductionApp {
  server: http.Server | https.Server;
  lifecycle: ILifecycle;
  listen: (port?: number, host?: string) => Promise<AddressInfo | string | null>;
  close: () => Promise<void>;
}

function createProductionServer(options?: ICreateProductionServerOptions): Promise<IProductionServer>;
```

Requests pass through health probes, client files, then SSR, which receives only what the file
server skipped. `compression` applies to rendered documents only. `listen` resolves with the bound
address and rejects bind errors. `close` is `lifecycle.close`. The server does not subscribe to
process signals; call `lifecycle.handleSignals()` when your process owns them.

```ts
const app = await createProductionServer({ buildDir: 'build', compression: true, health: true });

await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
app.lifecycle.handleSignals({ onExit: (code) => process.exit(code) });
```

## `prepareProduction`

```ts
interface IPrepareProductionOptions {
  buildDir?: string; // Default: ./build, then ./dist; an explicit directory must exist
  modulePreload?: boolean; // Default: false
  isSPA?: boolean; // Default: false
  static?:
    | Omit<IServeStaticOptions, 'root' | 'basename' | 'isSPA' | 'shellFile' | 'hasAccessIndexHtml'>
    | false;
  hasAccessIndexHtml?: () => boolean;
  loadEntry?: (file: string) => Promise<unknown>;
}

interface IProductionApp {
  handler: SsrHandler;
  staticMiddleware?: TStaticMiddleware; // Undefined with static: false
  paths: { root: string; base: string; publicDir: string; indexFile: string; serverFile: string };
}

function prepareProduction(options?: IPrepareProductionOptions): Promise<IProductionApp>;
```

Paths come from `server/ssr-boost.json`. The handler mounts the built `defineEntry` default export
with the HTML shell, route assets and Node renderer bound. An Express entry or a missing server
build throws an error naming the file. With `isSPA`, no server entry is loaded and the handler
answers every route with the built document and `Cache-Control: no-cache`. Mount
`staticMiddleware` before the handler; it calls `next()` for anything that is not a file.

## `serveStatic`

```ts
interface IServeStaticOptions extends ServeStaticOptions {
  root: string;
  basename?: string;
  isSPA?: boolean;
  immutableFiles?: Iterable<string>; // Paths relative to root
  shellFile?: string; // Absolute or relative to root, default 'index.html'
  hasAccessIndexHtml?: () => boolean;
}

function serveStatic(options: IServeStaticOptions): TStaticMiddleware;
```

Connect middleware on [serve-static](https://github.com/expressjs/serve-static) with the managed
Express server's behaviour: validators, ranges, HEAD and directory redirects stay with
serve-static; in SSR builds, URLs outside the client directory's top-level names go straight to
`next()`;
`/.well-known/` is served even though other dotfiles stay hidden, resolving `name` to `name.json`.
SSR builds hide the raw HTML shell unless `hasAccessIndexHtml()` returns true, so that URL reaches
the router. The shell is matched by the file it resolves to: any letter case, dot segments and,
when `extensions` lists its extension, the extensionless URL. `prepareProduction` passes the
`indexFile` from `ssr-boost.json`, so a renamed shell stays hidden too.

Files listed in `immutableFiles` get `Cache-Control: public, max-age=31536000, immutable`. Every
other file keeps serve-static's revalidating default, so a stable name such as
`assets/icon-facebook.svg` from `public/` is never pinned for a year. `ssr-boost build` writes the
files Vite emitted for the client (scripts, styles and imported assets, nested chunks included) to
`server/fingerprinted-files.json`, and `prepareProduction` passes that list unless you give your
own. A build without the file, such as one made before 8.7, revalidates everything. The list
trusts Vite's hashed output names; if your output file names drop `[hash]`, set `maxAge` or your
own `immutableFiles`. Setting `maxAge`, `immutable` or `cacheControl: false` hands the policy for
every file to you.

## `createLifecycle`

```ts
interface ILifecycleOptions {
  health?: boolean | { livePath?: string; readyPath?: string }; // true: /healthz, /readyz
  drainTimeoutMs?: number; // Default: 30000
  keepAliveTimeoutMs?: number; // Default: Node's
  headersTimeoutMs?: number; // Default: Node's
  requestTimeoutMs?: number; // Default: Node's
  onDrain?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
}

function createLifecycle(server: http.Server | https.Server, options?: ILifecycleOptions): ILifecycle;
```

Health probes are opt-in. The live path answers 200 while the process runs; the ready path answers
200 after `setReady()` and 503 once a drain starts. Both answer `GET` and `HEAD` with
`Cache-Control: no-store`.

`close()` is idempotent: every caller shares one drain. It stops accepting connections, closes idle
keep-alive sockets, sends `Connection: close` on responses still in flight and resolves once every
socket is gone. Responses that outlive `drainTimeoutMs` have their sockets destroyed. Upgraded
sockets (WebSocket, HMR) are destroyed once no HTTP response is active. `onDrain` runs as the drain
starts, `onClose` after it.

`handleSignals({ signals, onExit })` routes `SIGTERM` and `SIGINT` (by default) through `close()` and
returns an unsubscribe function; a second signal destroys the remaining sockets. The CLI uses it.
Embedded and serverless hosts own their lifecycle and leave it uncalled.

Timeouts stay at Node's defaults unless set. Behind a load balancer whose idle timeout is 60 seconds,
keep the server's keep-alive longer than the balancer's so the balancer closes first:

```ts
createProductionServer({
  keepAliveTimeoutMs: 65_000,
  headersTimeoutMs: 66_000,
  requestTimeoutMs: 300_000,
});
```

## `loadHtmlShell`

```ts
interface ILoadHtmlShellOptions {
  indexFile: string;
  outlet?: string; // Default: '<!--ssr-outlet-->'
}

function loadHtmlShell(options: ILoadHtmlShellOptions): Promise<() => IHtmlShell>;

interface IHtmlShell {
  header: string;
  footer: string;
}
```

Reads the UTF-8 file once and splits it at the outlet. The file must contain exactly one outlet;
an empty outlet, missing outlet or repeated outlet throws an error naming the file. Filesystem
read errors propagate to the caller.

The returned function creates a new `{ header, footer }` object each time, so request hooks can
change the shell without affecting other requests. It can be passed directly as `getHtml`.
Load a new shell when deploying a new build.

## `createRouteAssetPreparer`

```ts
type IRouteAssetPreparerOptions = (
  | { buildDir: string; manifest?: never }
  | { manifest: TRouteAssetsManifest; buildDir?: never }
) & { modulePreload?: boolean }; // Default: false

function createRouteAssetPreparer<TAppProps>(
  options: IRouteAssetPreparerOptions,
): NonNullable<ICreateHandlerOptions<TAppProps>['prepare']>;
```

`ICreateHandlerOptions` is the type exported by `core/handler`.

Pass the build directory containing `client/` and `server/`. The preparer resolves this path when
created, then reads `server/assets-manifest.json` when a request first has matched routes. Each
preparer caches its own manifest and shares the managed server's asset injection logic. It does
not discover builds from the working directory or use the managed server's manifest singleton.
Relative paths resolve against the working directory at creation; use an absolute path to start
the application from any directory.

Alternatively, import the parsed **`build/client/assets-manifest.json`** and pass `{ manifest }`:

```ts
import manifest from './build/client/assets-manifest.json';
const prepare = createRouteAssetPreparer({ manifest });
```

The CLI emits this alongside the identical `build/server/assets-manifest.json` after the normal
server build. It is not Vite's `.vite/manifest.json`. The exported `TRouteAssetsManifest` type accepts
a JSON import directly. `RouteAssets` from `services/route-assets` also accepts the object as its
first constructor argument, with `modulePreload` as the second. Manifest objects are not mutated.
For Workers use the edge-safe [Cloudflare entry](/guide/cloudflare), which uses the same injection
logic without importing the Node helpers.

The hook runs after React Router matches the request. It inserts matching route styles and scripts
before `</head>` in `context.html.header`; the shell must contain that closing tag. Lazy route IDs
must match the routes used for the build. `modulePreload: true` also inserts module preload links.
Asset URLs come from the manifest, including any base path configured during the build.

When the assets produce `Link` headers, the hook awaits `executionContext.onEarlyHints` if provided.
It works without that callback. The Node and Fastify adapters send these headers as HTTP 103 Early
Hints when the transport supports them. They are separate from the final response headers.

A missing manifest or a route without assets adds nothing, matching the managed server. Invalid
manifest JSON and read errors propagate. Create a new preparer when deploying a new build.

See the [Fastify launcher](/guide/runtime-adapters#adapters) for the complete server setup,
including static files and compression.
