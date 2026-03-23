# Getting Started

## Install

```bash
npm i @lomray/vite-ssr-boost
```

Peer dependencies matter here. The package expects modern `vite`, `react-dom`, `react-router`, Babel parser packages and Node `>=22`.

## Add the Vite plugin

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import SsrBoost from '@lomray/vite-ssr-boost/plugin';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../build',
  },
  plugins: [SsrBoost(), react()],
});
```

That is the minimal setup. The plugin handles SSR flags, route normalization and optional helpers such as SPA index generation or tsconfig aliases.

## Create the browser entry

```tsx
import entryClient from '@lomray/vite-ssr-boost/browser/entry';
import { createBrowserRouter } from 'react-router';
import App from './App';
import routes from './routes';

void entryClient(App, routes, {
  init: async ({ isSSRMode, router }) => {
    return {
      isSSRMode,
      currentUrl: router.state.location.pathname,
    };
  },
  routerOptions: {},
  createRouter: createBrowserRouter,
  rootId: 'root',
});
```

`entryClient` does two important things for you:

- preloads matched lazy routes before router creation so SSR hydration can stay in sync
- chooses hydration or plain SPA mount depending on SSR mode and `data-force-spa`

## Create the server entry

```tsx
import entryServer from '@lomray/vite-ssr-boost/node/entry';
import App from './App';
import routes from './routes';

export default entryServer(App, routes, {
  abortDelay: 15000,
  init: async ({ config }) => ({
    onServerCreated: (app) => {
      void app;
      void config;
    },
    onServerStarted: (_, __, server) => {
      void server;
    },
    onRequest: async (req) => ({
      appProps: {
        url: req.url,
      },
    }),
    onRouterReady: () => ({
      isStream: true,
    }),
    onShellReady: () => ({
      header: '',
      footer: '',
    }),
    onResponse: ({ html }) => html,
    onError: ({ error }) => {
      console.error(error);
    },
    getState: () => ({
      app: {
        hydratedAt: Date.now(),
      },
    }),
  }),
});
```

The package does not force one app-level abstraction. You decide what request state to prepare, whether to stream immediately, how to mutate HTML chunks and what serialized state should be sent to the client.

## Replace scripts

```json
{
  "scripts": {
    "develop": "ssr-boost dev",
    "build": "ssr-boost build",
    "start:ssr": "ssr-boost start",
    "start:spa": "ssr-boost start --focus-only client",
    "preview": "ssr-boost preview"
  }
}
```

`start:spa` above is the explicit form. Older examples often used `--only-client`, but the current CLI works through `--focus-only`.

## Run it

```bash
npm run develop
```

## Recommended project shape

```txt
src/
  App.tsx
  client.tsx
  server.ts
  routes.tsx
public/
vite.config.ts
```

You can move files around, but the defaults assume `client.ts`, `server.ts` and `index.html`. If you change that, configure the plugin options instead of relying on convention by accident.
