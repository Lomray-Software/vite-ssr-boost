# Migrate an existing Vite SPA

Add SSR while keeping your React Router [Data-mode route objects](https://reactrouter.com/start/modes) and components. This guide follows the five-file change in the [minimal example README](https://github.com/Lomray-Software/vite-template/tree/example/minimal#from-a-plain-vite-spa-to-this-project).

## Automatic: `npx ssr-boost init`

For a Vite + React app using `createBrowserRouter` and route objects, preview the migration first:

```bash
npx ssr-boost init --dry-run
npx ssr-boost init --apply
npm install
npx ssr-boost doctor
npm run build
npm run start:ssr
```

If the library is not installed yet, use `npx --package @lomray/vite-ssr-boost ssr-boost init --dry-run` (then repeat with `--apply`). This downloads the CLI to npm's cache; `init` itself never installs dependencies. With neither flag, `init` defaults to a dry run and prints a unified diff without creating files. `--root <dir>`, `--entry <file>` and `--routes <file>` select the project, browser entry and exported route module; file overrides are relative to the project directory.

The command makes the five integration changes below: adds `SsrBoost()` while preserving existing plugins, inserts the outlet inside `#root`, replaces the browser bootstrap with the library entry, creates an Express server entry next to it, and updates the dependency and scripts. An existing `dev` script becomes `ssr-boost dev` without adding a duplicate `develop`; otherwise it updates or adds `develop`. It always sets `build` to `ssr-boost build` and adds `start:ssr` as `ssr-boost start`. A stock `preview` script also switches to `ssr-boost preview`. It preserves an imported App wrapper around `RouterProvider`. For `StrictMode`, a Fragment, or no wrapper, it creates an explicit App component in both entries so the browser and server render the same tree. Inline route declarations and their dependencies move into an additional `routes.ssr.tsx` (or JS/TS equivalent) module shared by both entries. Existing exported route modules stay in place, preserving their import specifiers and local bindings. Repeating `--apply` makes no further changes.

Automatic migration supports TypeScript and JavaScript, root `index.html` and Vite `root: 'src'`, literal plugin arrays, static routes, and conventional aliases. It stops before writing for JSX `BrowserRouter`/`Routes`, missing or multiple `createBrowserRouter` calls, multiple HTML/build entries, runtime-generated Vite configuration, an existing server file, custom router options, wrappers requiring extra props, additional browser startup statements, or a Vite `base` other than `/`. The error identifies the file and construct and links to this manual reference. It does not invent metadata providers or request hooks: adapt those with the steps below when your app needs them.

Run [`doctor --json`](/api/cli#ssr-boost-doctor) after further changes. Review browser globals in your components using the [pitfalls below](#pitfalls).

## Prerequisites

- Node 22: the package declares `engines.node: ">=22.12.0"`; use Node 22.23.2 for this example and its tooling.
- Vite 5 or newer, React and React DOM 18.2 or newer, and React Router 7 route objects (`react-router >=7.0.1`). The source example uses Vite 8, React 19 and React Router 8; match your dependencies' peer and engine requirements.
- Install `@lomray/vite-ssr-boost`; the copied entries also use `@lomray/react-head-manager` and `isbot`. The example's [package.json](https://github.com/Lomray-Software/vite-template/blob/example/minimal/package.json) lists all six direct runtime dependencies and the build tools, including `@vitejs/plugin-react` and `vite-plugin-devtools-json`.

These entries assume the example's shared [App wrapper](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/app.tsx), [routes](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/routes/index.ts), [state keys](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/constants/state-key.ts) and [tsconfig aliases](https://github.com/Lomray-Software/vite-template/blob/example/minimal/tsconfig.json). `App` accepts a meta manager through its `client` or `server` props and provides it to the route tree. Add that wrapper and metadata provider first if your SPA does not have them, then adapt the import paths to your application.

## The five-file change

The five after blocks below are copied in full from `example/minimal` at commit `789816f29efa9e25280486085470a5b2fa419e84`. The before files are linked beside each change; they are documentation fixtures in the template. This comparison starts with an app whose Vite root is already `src` and whose shared wrapper already supplies metadata.

### `vite.config.ts`

Before: [Vite SPA configuration](https://github.com/Lomray-Software/vite-template/blob/example/minimal/docs/spa-before/vite.config.ts.txt). Add the plugin import and `SsrBoost()` to `plugins`; the plugin supplies alias handling and the CLI handles build cleanup, replacing `resolve.tsconfigPaths` and `emptyOutDir` in the before file.

After — source: [vite.config.ts](https://github.com/Lomray-Software/vite-template/blob/example/minimal/vite.config.ts).

```ts
import SsrBoost from '@lomray/vite-ssr-boost/plugin';
import devtoolsJson from 'vite-plugin-devtools-json';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  root: 'src',
  publicDir: '../public',
  envDir: '../',
  build: {
    outDir: '../build',
  },
  plugins: [devtoolsJson(), SsrBoost(), react()],
});
```

### `src/index.html`

Before: [SPA HTML](https://github.com/Lomray-Software/vite-template/blob/example/minimal/docs/spa-before/src/index.html.txt). Add the SSR outlet inside the root element and keep the client script.

After — source: [src/index.html](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/index.html).

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
  </head>
  <body>
    <div id="root"><!--ssr-outlet--></div>
    <script type="module" src="/client.ts" async></script>
  </body>
</html>
```

### `src/client.ts`

Before: [SPA client entry](https://github.com/Lomray-Software/vite-template/blob/example/minimal/docs/spa-before/src/client.ts.txt). Replace the direct router and `createRoot` setup with `entryClient`, which hydrates SSR HTML or mounts the SPA and restores metadata state.

After — source: [src/client.ts](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/client.ts).

```ts
import { Manager as MetaManager } from '@lomray/react-head-manager';
import entryClient from '@lomray/vite-ssr-boost/browser/entry';
import getServerState from '@lomray/vite-ssr-boost/helpers/get-server-state';
import StateKey from '@constants/state-key';
import routes from '@routes/index';
import App from './app';

void entryClient(App, routes, {
  init: () =>
    Promise.resolve({
      metaManager: new MetaManager(getServerState(StateKey.metaManager, import.meta.env.PROD)),
    }),
});
```

### `src/server.ts`

Before: the SPA has no server entry. Add the managed Express entry, create a meta manager per request, inject its tags before the shell, and transfer its state to the browser.

After — source: [src/server.ts](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/server.ts).

```ts
import { Manager as MetaManager } from '@lomray/react-head-manager';
import MetaServer from '@lomray/react-head-manager/server';
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';
import { isbot } from 'isbot';
import StateKey from '@constants/state-key';
import routes from '@routes/index';
import App from './app';

export default entryServer(App, routes, {
  init: () => ({
    onRequest: () => ({ appProps: { metaManager: new MetaManager() } }),
    onRouterReady: ({ context: { request } }) => ({
      isStream:
        !isbot(request.headers.get('user-agent') ?? '') &&
        !/(?:^|;\s*)isCrawler=1(?:;|$)/.test(request.headers.get('cookie') ?? ''),
    }),
    onShellReady: ({ context: { appProps, html } }) => ({
      header: MetaServer.inject(html.header, appProps.metaManager),
    }),
    getState: ({ context: { appProps } }) => ({
      [StateKey.metaManager]: MetaServer.getState(appProps.metaManager),
    }),
  }),
});
```

Crawler user agents and the `isCrawler=1` cookie select a complete response before sending it. The client entry restores the metadata state from the same request.

### `package.json` scripts

Before: [Vite scripts](https://github.com/Lomray-Software/vite-template/blob/example/minimal/docs/spa-before/package.json.txt). Replace the development, build and preview commands and add SSR/SPA start scripts. This is the complete `scripts` object; keep the rest of `package.json` and retain your own tooling scripts if their tools differ. The `smoke` script requires the example's [scripts directory](https://github.com/Lomray-Software/vite-template/tree/example/minimal/scripts).

After — source: [package.json](https://github.com/Lomray-Software/vite-template/blob/example/minimal/package.json), the `scripts` object printed with `JSON.stringify(scripts, null, 2)`.

```json
{
  "develop": "ssr-boost dev",
  "build": "ssr-boost build",
  "build:spa": "ssr-boost build --focus-only client",
  "start:ssr": "ssr-boost start",
  "start:spa": "ssr-boost start --focus-only client",
  "preview": "ssr-boost preview",
  "smoke": "node scripts/smoke.mjs",
  "lint:check": "eslint \"src/**/*.{ts,tsx,*.ts,*tsx}\" --max-warnings=0",
  "lint:format": "eslint --fix \"src/**/*.{ts,tsx,*.ts,*tsx}\"",
  "style:check": "stylelint \"src/**/*.{css,scss}\"",
  "style:format": "stylelint --fix \"src/**/*.{css,scss}\"",
  "ts:check": "tsc --project ./tsconfig.json --skipLibCheck --noemit",
  "prepare": "husky"
}
```

Run `npm run dev` if your app has a `dev` script, or `npm run develop` for the example above. Run `npm run build` and then `npm run start:ssr` to serve the SSR build.

## Data loading

Loader and action promises stream by default in Data mode. Return `{ fast, slow: fetchSlow() }` and consume `slow` inside Suspense with `<Await>` or React 19 `use()`. The browser reconstructs native promises before creating the router; client navigation loaders keep their native promises. See [Stream loader data](/guide/data-streaming) for the supported value matrix, errors and opt-in `hydration: 'early'`. Custom `getState` snapshots still use JSON.

The [users page](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/pages/users/index.tsx) shows a loader that waits for its data before returning. Keep loader code usable in the browser for client navigation; call an API for server-only operations.

## Pitfalls

### Browser globals at module scope

Server imports execute without `window` or `document`. Move browser access into effects, or use a lazy `onlyClient` route with a fallback as shown in the [example routes](https://github.com/Lomray-Software/vite-template/blob/example/minimal/src/routes/index.ts).

### Loader promises

Use the [data-loading contract above](#data-loading) when deciding which work belongs in a loader. Check the first browser render as well as the server response when changing that boundary.

### CSS imported by dependencies

If a dependency imports CSS that needs Vite's server transforms, include the package in `ssr.noExternal`. [Vite's SSR externals documentation](https://vite.dev/guide/ssr.html#ssr-externals) explains when dependencies bypass those transforms.

### Environment variables

Read public values through `import.meta.env` and keep secrets out of `VITE_*` variables, which are exposed to client code. Restart development after changing env files; see [Vite's environment variable guide](https://vite.dev/guide/env-and-mode.html).

### Hydration mismatches

Compare the server HTML with the initial browser render, including data, dates, randomness and browser-dependent branches. [React's hydration troubleshooting](https://react.dev/reference/react-dom/client/hydrateRoot#troubleshooting) requires those outputs to match; correct their inputs before hiding a warning.

## Going back to SPA

Run `npm run build:spa`, then `npm run start:spa`; both scripts select `--focus-only client`. The app keeps the same route objects and browser entry, and the build omits the SSR server. Run `npm run build` again before returning to `npm run start:ssr`.
