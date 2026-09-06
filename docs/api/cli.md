# CLI

## Binary

```bash
ssr-boost
```

The CLI is the operational face of the package. It drives development, builds, preview mode and deployment-oriented packaging.

## Main commands

### `ssr-boost init`

Adds SSR to an existing Vite + React Router Data-mode app. The default is a dry run:

```bash
npx ssr-boost init --dry-run
npx ssr-boost init --apply
npm install
```

Before installing the library, invoke it with `npx --package @lomray/vite-ssr-boost ssr-boost init`.

| Option | Meaning |
| --- | --- |
| `--dry-run` | Print a unified diff of every proposed file; write nothing (default). |
| `--apply` | Write the complete plan after validating it. Cannot be combined with `--dry-run`. |
| `--root <dir>` | Project directory; defaults to the current directory. |
| `--entry <file>` | Browser file relative to the project; must match the HTML module script. |
| `--routes <file>` | Module with one exported route array, relative to the project. |

Example output excerpt:

```diff
--- a/index.html
+++ b/index.html
@@ -1 +1 @@
-<div id="root"></div>
+<div id="root"><!--ssr-outlet--></div>
```

```text
Dry run: no files written. Use --apply to write these changes.
Next: npm install; then npx ssr-boost doctor.
```

The remaining diffs show the Vite plugin, browser/server entries, scripts and dependency, plus an extracted route module when the routes were inline. The CLI preserves surrounding source, quotes and line endings where possible; it does not require Prettier. It never installs dependencies. A second `--apply` prints `No changes: SSR is already initialized. Run ssr-boost doctor.`

An existing `dev` script becomes `ssr-boost dev`; no duplicate `develop` is added. Without `dev`, the command updates or adds `develop`. It always sets `build` to `ssr-boost build` and adds `start:ssr` as `ssr-boost start`; a stock `vite preview` script becomes `ssr-boost preview`. Existing routes imports keep their module specifier and binding (for example, `import { routes } from './routes'`). `StrictMode`, Fragment, and unwrapped roots get an explicit App component in both entries to preserve the render tree without forwarding entry props to React built-ins.

Unsupported layouts exit 1 before writing and include the [manual migration guide](/guide/migrate-existing-spa). See that guide for supported layouts and constraints, including custom bases and provider initialization.

### `ssr-boost doctor`

Inspects the project without importing application modules, executing Vite plugins, or reading environment files:

```bash
npx ssr-boost doctor
npx ssr-boost doctor --json --root ./my-app
npx ssr-boost doctor --bundle support.json
```

| Option | Meaning |
| --- | --- |
| `--json` | Print a JSON report instead of the check table. |
| `--root <dir>` | Project directory; defaults to the current directory. |
| `--bundle <file>` | Write a support bundle JSON, relative to the project directory (absolute paths also work). |

Each table/JSON check has `name`, `status` (`ok`, `warn`, `error`), a message and a one-line `fix`. Exit status is **1 if any check is an error**, otherwise **0**. An `ok` fix describes how to maintain that condition.

Table excerpt:

```text
status  check         message                                 fix
ok      node          Node 22.23.2 satisfies engines           Use a Node version satisfying the package and app engines (CI uses 22.23.2).
ok      vite-plugin   SsrBoost() is in the Vite plugins        Add SsrBoost() from @lomray/vite-ssr-boost/plugin to Vite plugins.
error   html-outlet   index.html: expected one outlet, found 0 Place exactly one <!--ssr-outlet--> inside the root element.
```

JSON check excerpt:

```json
{
  "name": "routes",
  "status": "ok",
  "message": "2 route IDs resolved",
  "fix": "Use statically analyzable route objects; follow the file and line in the parser error."
}
```

Checks cover readable package metadata; installed `@lomray/vite-ssr-boost`, React, React DOM, React Router and Vite versions; Node against the library, app and installed runtime engines; physical duplicate React copies via `npm ls react react-dom --json --all --long`; the imported Vite plugin; the HTML module script and exactly one outlet; both library entries; the actual route parser; and development/build/SSR scripts. Per-package `version:*` checks verify installation and peer ranges; missing packages or unsatisfied peer ranges are errors. A single `compatibility` check is `ok` only when React and React DOM, React Router, and Vite exactly match a row in the [compatibility workflow](https://github.com/Lomray-Software/vite-ssr-boost/blob/staging/.github/workflows/react-compatibility.yml). Otherwise it warns with the installed trio and closest tested row. The closest row has the most matching components, with ties resolved by proximity of React, Router, then Vite versions. Those rows ship with the CLI and a test prevents drift.

```text
warn  compatibility  React 19.2.8 + Router 7.18.3 + Vite 8.2.2 is not a tested row; closest: React 19.2.8 + Router 7.18.3 + Vite 7.3.6
fix: Use React and React DOM 19.2.8, React Router 7.18.3, and Vite 7.3.6 for a tested combination.
```

The `robots` and `size-budget` checks have `info: true`: they report missing/custom/blocked crawl policies and the presence of a size budget script without changing policy or failing the check. Doctor uses static configuration analysis; configuration it cannot resolve gets an actionable error instead of executing arbitrary config code.

The support bundle (`schemaVersion: 1`) includes versions, adapter, route IDs and literal paths, check names/statuses/fixes, and known diagnostic codes from the last recorded build. It omits raw error messages, npm trees, source code, cookies, environment values, loader/state data, and other application data. A pathless route or a dynamic path helper is represented by `path: null`; the tool does not execute path helpers. Successful managed builds record only known codes in `<outDir>/ssr-boost-diagnostics.json`, resetting the list for each build. An absent or invalid record yields an empty list. See [development diagnostics](/reference/diagnostics) for code meanings.

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
