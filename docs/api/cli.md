# CLI

## Binary

```bash
ssr-boost
```

The CLI is the operational face of the package. It drives development, builds, preview mode and deployment-oriented packaging.

## Main commands

### `ssr-boost dev`

Runs the development server.

Common flags:

- `--host`
- `--port`
- `--reset-cache`
- `--mode`
- `--entrypoint`

## `ssr-boost build`

Creates a production build.

Common flags:

- `--focus-only [all|app|client|server|entrypoint]`
- `--mode`
- `--client-options`
- `--server-options`
- `--unlock-robots`
- `--eject`
- `--serverless`
- `--throw-warnings`

## `ssr-boost start`

Runs the production server.

Common flags:

- `--host`
- `--port`
- `--focus-only`
- `--build-dir`
- `--module-preload`

## `ssr-boost preview`

Builds in watch mode and boots the production server once output is ready.

Common flags:

- `--focus-only`
- `--host`
- `--port`
- `--mode`
- `--build-dir`

## Deployment helpers

### `ssr-boost build-docker`

Flags:

- `--image-name`
- `--docker-options`
- `--docker-file`
- `--focus-only`
- `--mode`

### `ssr-boost build-amplify`

Flags:

- `--manifest-file`
- `--is-optimize`
- `--mode`

### `ssr-boost build-vercel`

Flags:

- `--config-file`
- `--config-vc-file`
- `--is-optimize`
- `--mode`

## Focus modes

`--focus-only` controls which part of the app should be built or started:

- `all`
- `app`
- `client`
- `server`
- `entrypoint`

This is the main switch when you want a narrower production action instead of rebuilding everything every time.
