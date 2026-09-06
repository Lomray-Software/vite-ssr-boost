# Deployment

## Core commands

The package CLI covers the main operational flows:

- `ssr-boost dev`
- `ssr-boost build`
- `ssr-boost start`
- `ssr-boost preview`
- `ssr-boost build-docker`
- `ssr-boost build-amplify`
- `ssr-boost build-vercel`

## Build output shape

A normal build creates separate client and server outputs under your Vite `outDir`.

Typical shape:

```txt
build/
  client/
  server/
    server.js
    assets-manifest.json
    ssr-boost.json
```

If you set `build.outDir: '../dist'`, start it with `ssr-boost start --build-dir dist`.

When server output is built, the package also generates an SSR manifest for route assets.

## Production startup

`ssr-boost build` resolves Vite configuration and writes `server/ssr-boost.json`. This versioned
descriptor contains the build root, base URL, build mode, public directory and output filenames
resolved from the plugin's index/server options. Paths are relative to the output, so the build
can be moved with its production dependencies. Deploy the descriptor with the rest of the build.
Application hooks, loggers and middleware options remain in the compiled managed server entry.
Development shortcuts, aliases, environment files and executable Vite plugin configuration are
not serialized into the descriptor.

Ordinary `ssr-boost start` invocations parse their flags with Node's argument parser, load the
descriptor and start the existing managed Express server. The server loads Express, compression,
the compiled application and its React rendering dependencies. It reads the HTML shell and route
asset manifest on first use and caches them for that server. Colored server messages still use
Chalk. Vite, config resolution, the CLI command tree, Commander, migration tools, Babel and
TypeScript path analysis are absent from this serving path. Help, errors and optional-value
syntax are delegated to the existing CLI parser; other commands load their implementations on demand.

All start flags and the managed entry contract remain supported. Builds made by older versions
without a descriptor retain the conventional `build`/`dist` paths; no Vite config is evaluated
as a fallback. Rebuild to pick up changes to Vite or plugin configuration. The existing `--eject`
runner also calls this same managed server implementation.

Measure a built app with Node's profiler and module diagnostics:

```bash
NODE_ENV=production NODE_DEBUG=esm,module node --cpu-prof --trace-warnings \
  node_modules/@lomray/vite-ssr-boost/cli.js start
```

Send requests before stopping the server to include first-request rendering and manifest reads
in the profile. `NODE_DEBUG` covers ESM and CommonJS; `process.moduleLoadList` alone lists Node's
internal/native modules and does not count all application imports. Keep profiling runs separate
from timing runs because tracing changes startup costs.

For repeatable acceptance measurements, run `node scripts/test-template.mjs /path/to/vite-template`
from the library checkout after `npm run build`. Its cold-start measurement includes the npm
launcher and waits for a complete HTTP 200, with five fresh processes and 25 ms polling. It also
samples `process.memoryUsage()` in the listening server after TTFB, without forced GC. Both are
compared with a plain ESM Express + `renderToPipeableStream` process using the same installed
dependencies. See [acceptance gates](/reference/acceptance-gates) for the enforced budgets.

## Streamed HTML and compression

In production, the managed Express server records the built client directory's top-level
file and directory names at startup. URLs outside those prefixes go straight to SSR without
a filesystem lookup. Built assets and public files retain Express's validators, ranges, HEAD
responses and directory redirects. Add new top-level public files before starting the server;
restart after changing the build. Custom extension fallbacks and `fallthrough: false` retain
the unrestricted static middleware.

On React versions that expose `renderToReadableStream`, the Node renderer uses that native
Web stream directly. React 18 retains the pipeable renderer and its bounded Node-to-Web bridge.
Both paths preserve cancellation, shell hooks and downstream demand.

The managed Express server keeps gzip enabled for HTML. The response writer flushes compression
after each HTML chunk, before waiting for transport capacity. This delivers the shell while
Suspense data is pending and preserves backpressure for later chunks. Buffered responses remain
compressible. The Fetch core queues the prepared document header once React's shell is ready;
it does not read later React chunks until the consumer requests them.

Compression's default threshold is 1 KB, but a response without a known length is treated as
exceeding that threshold. Flushing headers alone does not flush compressed HTML. If you add
another compression layer or a reverse proxy, preserve incremental delivery and measure the
first decoded HTML byte. See the [compression middleware documentation](https://expressjs.com/en/resources/middleware/compression/).

To compare the managed adapter, Node/edge Fetch renderers and raw React on a local checkout, run:

```bash
npm run build
NODE_ENV=production SSR_BOOST_TIMELINE=1 CONCURRENCY=1 node scripts/profile-stream.mjs
```

The in-process report includes router-query completion, preparation, shell readiness, the first
adapter write, the first socket write, headers received and decoded HTML received. Times are p50
milliseconds from Express middleware entry. These are elapsed stages, not CPU measurements.
`SAMPLES`, `WARMUP`, `WARMUP_CONCURRENCY`, `CONCURRENCY`, `RUNTIMES=raw,managed,node,edge` and
`ENCODINGS=identity,gzip` control the run.

For service cost, run the actual production application in a separate process with the local
profiling preload. It handles the profiler's control requests and records process CPU usage
between measured batches. Run the client separately with one connection:

```bash
NODE_ENV=production node --import /path/to/vite-ssr-boost/scripts/profile-server.mjs server.mjs
PROFILE_URL=http://127.0.0.1:3000 CONCURRENCY=1 SAMPLES=50 WARMUP=100 WARMUP_CONCURRENCY=10 ENCODINGS=identity \
  node scripts/profile-stream.mjs > service.jsonl
```

The warm-up can use ten connections to exercise the same hot paths as a throughput run;
measured requests still use the requested concurrency. `ROUTES=/,/items,/items/1` selects the production paths. Every measured response must return 200.
The report separates client TTFB from mean CPU microseconds per complete response. On Node
22.19 and newer, `mainThreadCpuUsPerRequest` uses `process.threadCpuUsage()` to measure the
event-loop thread independently of background workers. `cpuUsPerRequest` also includes those
workers. Loader timers contribute elapsed time but do not count as CPU. See the
[Node CPU accounting API](https://nodejs.org/api/process.html#processthreadcpuusagepreviousvalue). Keep the server isolated from
other traffic, builds and tests.

For stage attribution, add `--cpu-prof --cpu-prof-interval=100 --cpu-prof-name=server.cpuprofile`
to the server command, then run the client and stop the server with SIGTERM. The preload exits
normally so Node writes the profile. Summarize only the marked measurement windows:

```bash
node scripts/summarize-cpu.mjs server.cpuprofile service.jsonl
```

The summary reports time-weighted active samples in microseconds per request, excluding idle,
startup and warm-up. These are sampling estimates. The process CPU counter in a profiled run
also includes profiler overhead, so use a separate run without `--cpu-prof` for that counter.
Gzip's first socket write can contain only its header; decoded HTML arrival is reported separately.

## Preview mode

`ssr-boost preview` runs watch builds and starts the production server after the output is ready.

This is useful when you want production-like behavior locally without switching to a manual build plus start sequence.

## Cloudflare Workers

See [Cloudflare Workers](/guide/cloudflare) for the Worker entry, Static Assets binding,
`ssr-boost build --focus-only all`, Wrangler preview and deployment.

## Docker

```bash
ssr-boost build-docker --image-name my-app
```

Use optional flags such as:

- `--docker-options`
- `--docker-file`
- `--focus-only`
- `--mode`

## AWS Amplify

```bash
ssr-boost build-amplify
```

Optional flags:

- `--manifest-file`
- `--is-optimize`
- `--mode`

## Vercel

```bash
ssr-boost build-vercel
```

Optional flags:

- `--config-file`
- `--config-vc-file`
- `--is-optimize`
- `--mode`

## Eject and serverless

Build-time flags:

- `--eject` generates a server start entrypoint in build output
- `--serverless` generates a serverless entrypoint

These are useful when deployment expects a plain Node file or a serverless wrapper instead of the package CLI.

## Static assets base

New builds use the recorded Vite `base` as the default static middleware basename. An explicit
middleware basename still takes precedence. For example:

```ts
export default entryServer(App, routes, {
  middlewares: {
    expressStatic: {
      basename: '/static',
    },
  },
});
```

That should match:

```ts
export default defineConfig({
  base: '/static',
});
```

## Custom entrypoints

You can define additional entrypoints in plugin config. This is a strong fit for:

- Capacitor shells
- embedded apps
- extra branded entry surfaces
- service-worker-oriented SPA shells

Each entrypoint can override:

- `indexFile`
- `clientFile`
- `serverFile`
- `buildOptions`

See [Recipes](/examples/recipes) for concrete examples.
