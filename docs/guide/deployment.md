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
