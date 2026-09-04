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
```

If you set `build.outDir: '../dist'`, start it with `ssr-boost start --build-dir dist`.

When server output is built, the package also generates an SSR manifest for route assets.

## Preview mode

`ssr-boost preview` runs watch builds and starts the production server after the output is ready.

This is useful when you want production-like behavior locally without switching to a manual build plus start sequence.

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

If Vite uses a custom `base`, reflect it in server static middleware as well:

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
