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
server skipped. `compression` applies to rendered documents only. `listen` is `lifecycle.listen`:
it resolves with the bound address, rejects bind errors and rejects once `close()` has started.
`close` is `lifecycle.close`. The server does not subscribe to process signals; call
`lifecycle.handleSignals()` when your process owns them.

Compression never re-encodes an answer the handler already shaped: a response with
`Content-Encoding`, `Content-Range`, `Cache-Control: no-transform`, a 204, 206 or 304 status, or a
`HEAD` request passes through unchanged. A compressed document keeps its own `Vary` values and
every `Set-Cookie` line, and gains `Vary: Accept-Encoding`. Brotli is not offered by default; pass
`compression: { format }` to pin one encoding.

Error answers carry only safe headers: validators (`ETag`, `Last-Modified`), ranges
(`Accept-Ranges`, `Content-Range`), `Content-Encoding`, `Content-Language`, `Content-Length`,
`Trailer` and `Transfer-Encoding` are dropped. The headers of a thrown error are applied only for a
client error (status below 500), and never its `Content-Encoding`, `Content-Length`, `Trailer` or
`Transfer-Encoding`. A range past the end of a file answers 416 with
`Content-Range: bytes */<size>`.

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
answers every route with the built document and `Cache-Control: no-cache`; `staticMiddleware`
sends the same policy when `/` or `/index.html` resolves to that document. Mount
`staticMiddleware` before the handler; it calls `next()` for anything that is not a file.

## `serveStatic`

```ts
interface IServeStaticOptions {
  // serve-static options: acceptRanges, cacheControl, dotfiles, etag, extensions, fallthrough,
  // immutable, index, lastModified, maxAge, redirect, setHeaders
  root: string;
  basename?: string;
  isSPA?: boolean;
  immutableFiles?: Iterable<string>; // Paths relative to root
  shellFile?: string; // Absolute or relative to root, default 'index.html'
  hasAccessIndexHtml?: () => boolean;
}

function serveStatic(options: IServeStaticOptions): TStaticMiddleware;
```

`IServeStaticOptions` declares the `serve-static` options itself, so `node/production` needs no
`@types/serve-static`; only the Express entry's `middlewares.expressStatic` uses that optional peer.

Connect middleware on [serve-static](https://github.com/expressjs/serve-static) with the managed
Express server's behaviour: validators, ranges, HEAD and directory redirects stay with
serve-static; in SSR builds, URLs outside the client directory's top-level names go straight to
`next()`;
`/.well-known/` is served even though other dotfiles stay hidden, resolving `name` to `name.json`.
SSR builds hide the raw HTML shell unless `hasAccessIndexHtml()` returns true, so that URL reaches
the router. The shell is matched by the file it resolves to: any letter case, dot segments and,
when the file server for that path appends an extension the shell's name ends with
(`extensions`, multi-part ones such as `en.html` included, or `json` under `/.well-known/`), the
extensionless URL. That URL is still resolved by send, only without that extension: a literal
file, a directory redirect or another listed extension is served in send's order, and a miss
reaches the router, also with `fallthrough: false`. `prepareProduction` passes the
`indexFile` from `ssr-boost.json`, so a renamed shell stays hidden too. The match is by path: a
symlink or a copy of the shell under another name in the client directory is served as a file.

Files listed in `immutableFiles` get `Cache-Control: public, max-age=31536000, immutable`. Every
other file keeps serve-static's revalidating default, so a stable name such as
`assets/icon-facebook.svg` from `public/` is never pinned for a year. `ssr-boost build` writes the
client files Vite emitted (scripts, styles and imported assets, nested chunks included) to
`server/fingerprinted-files.json`, and `prepareProduction` passes that list unless you give your
own. A build without the file, such as one made before 8.7, revalidates everything. A file is
listed only when its name comes from an `entryFileNames`, `chunkFileNames` or `assetFileNames`
string pattern with `[hash]`, so a stable name such as `assets/app.js` keeps revalidating. Names
from a function pattern are never listed; give your own `immutableFiles` for them. With several
outputs, a kind of file is listed only when every output names it with `[hash]`, since the
manifest does not say which output wrote a file. The list is decided by the name, not by the
content: a plugin that emits a file under an explicit `fileName` shaped like a hashed name, such
as `assets/logo-abcd1234.svg`, is listed too. Give your own `immutableFiles` when a plugin does
that with stable content. A path is matched as written, case included, so on a case-insensitive
disk a request that changes the case of a hashed name gets the revalidating default instead of
the year-long one. Setting
`maxAge`, `immutable` or `cacheControl: false` hands the policy for every file to you.

With the default `fallthrough` and no `extensions`, SSR builds read the top-level names of the
client directory once, when the middleware is created. A top-level file or folder added later
goes to `next()` until the server restarts; files added under a name that already existed are
served at once. With `fallthrough: false` or `extensions`, requests skip that prefix filter;
the mount and shell checks still run first.

With `isSPA`, the shell file is sent with `Cache-Control: no-cache`, the same policy as the route
fallback, whether it is reached as `/` or by its own name. This differs from the managed Express
server, which serves that file with serve-static's revalidating default.

## `createLifecycle`

```ts
interface ILifecycleOptions {
  health?: boolean | { livePath?: string; readyPath?: string }; // true: /healthz, /readyz
  drainTimeoutMs?: number; // Default: 30000, per phase
  readinessGraceMs?: number; // Default: 0
  keepAliveTimeoutMs?: number; // Default: Node's
  headersTimeoutMs?: number; // Default: Node's
  requestTimeoutMs?: number; // Default: Node's
  onDrain?: () => Promise<void> | void;
  onClose?: () => Promise<void> | void;
}

interface ILifecycle {
  setReady: () => void;
  isReady: () => boolean;
  isDraining: () => boolean;
  health: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  listen: (port?: number, host?: string) => Promise<AddressInfo | string | null>;
  close: () => Promise<void>;
  force: () => void;
  handleSignals: (options?: {
    signals?: NodeJS.Signals[]; // Default: ['SIGTERM', 'SIGINT']
    onSignal?: (signal: NodeJS.Signals) => void;
    onExit?: (code: number) => void;
    shouldHandle?: (signal: NodeJS.Signals) => boolean;
  }) => () => void;
}

function createLifecycle(server: http.Server | https.Server, options?: ILifecycleOptions): ILifecycle;
```

The two health probes need two paths: `createLifecycle` throws a `TypeError` when `livePath` and
`readyPath` resolve to the same path, since liveness would then answer 200 on the readiness URL
while the server drains. A path given as `undefined` keeps its default. `createProductionServer`,
`createDevServer` and the Express `createServer` check this before they start Vite or load the
entry, and keep the paths they checked. A probe matches an absolute-form target such as
`GET http://host/readyz` by its path.

Bind through `listen`, not `server.listen`: it applies the timeouts, rejects once `close()` has
started or while an earlier native `server.close()` has not emitted `close`, and `close()` waits
for a bind still in flight within the drain deadline. A bind on a server that is not listening
starts on the next turn of the event loop, so a native `close()` called just before or after it,
even one from before the lifecycle existed or a repeated one on a stopped server, cancels it
instead of leaving a port the promise does not report. When the connection count of the stopped
server cannot be read, `listen` rejects with that error rather than bind while an earlier close may
still drain. A bind that completes after the drain moved on is closed at once, so the port is not
left open.

Health probes are opt-in. The live path answers 200 while the process runs; the ready path answers
200 after `setReady()` and 503 once a drain starts. Both answer `GET` and `HEAD` with
`Cache-Control: no-store`; other methods get 405.

`close()` is idempotent: every caller shares one drain. It stops accepting connections, closes idle
keep-alive sockets, sends `Connection: close` on responses still in flight and resolves once every
socket is gone. Upgraded and tunnelled sockets (WebSocket, HMR, `CONNECT`) are tracked too and
destroyed once no HTTP response is active. A response the application answers from its own
`checkContinue` or `checkExpectation` listener counts as active too. `onDrain` runs after the
readiness grace, beside the socket drain, and `onClose` after it.

`drainTimeoutMs` bounds each phase on its own: the socket drain with `onDrain`, then `onClose`.
When a phase runs out, its remaining sockets are destroyed and a hook still running makes `close()`
reject with a message naming the hook, so a stuck dependency cannot hold the process forever.
Sockets accepted before the lifecycle was created are not tracked; when they still keep the server
open shortly after the deadline, `close()` rejects instead of waiting for them.
`force()` ends the drain at once: it destroys every socket, stops waiting for the hooks and starts
the drain when none is under way.

`readinessGraceMs` keeps the server accepting for that long after readiness turns 503, so a load
balancer or a Kubernetes readiness probe takes the instance out of rotation before the port closes.
Set it a little above the probe's `periodSeconds * failureThreshold`, and keep
`terminationGracePeriodSeconds` above the grace plus the drain. `force()` cuts the grace short.

`handleSignals({ signals, onSignal, onExit, shouldHandle })` routes `SIGTERM` and `SIGINT` (by
default) through `close()` and returns an unsubscribe function. A signal that arrives while a drain
is already under way joins it; the next signal calls `force()`. `onExit` receives 0 after a clean
drain and 1 when it failed. The lifecycle subscribes ahead of listeners already present, so
`shouldHandle` is checked when a signal arrives and before they run, a `process.once` handler
included; when it returns `false`, that signal is left to other listeners and the drain does not
start. The CLI uses it:
`ctrl+c` in the terminal forces the drain on the second press, and a restart requested while the
process is exiting is skipped. With the Express server the CLI checks, when a signal arrives,
whether the application subscribed its own handler for it and leaves that signal alone if so.
Embedded and serverless hosts own their lifecycle and leave it uncalled.

A listener the application adds later with `prependListener` or `prependOnceListener` is moved
behind the lifecycle on the next microtask. A signal raised with `process.emit` in that same
synchronous turn reaches the application's listener first; a signal from the operating system
always arrives on a later turn.

Timeouts stay at Node's defaults unless set. Behind a load balancer whose idle timeout is 60
seconds, keep the server's keep-alive longer than the balancer's so the balancer closes first:

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
