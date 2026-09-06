# Entry shapes (SSR Boost 8.x)

Adapt import paths to the application's existing modules. Managed entry defaults are relative to the Vite root; `init` emits explicit options for a stock root-level Vite project. Keep its actual filenames. These examples use the minimal template's `src` root and routes module.

## HTML and Vite

```html
<!-- src/index.html: keep the rest of the existing document -->
<div id="root"><!--ssr-outlet--></div>
<script type="module" src="/client.ts" async></script>
```

```ts
// vite.config.ts; preserve other plugins and application settings.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import SsrBoost from '@lomray/vite-ssr-boost/plugin';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  envDir: '..',
  build: { outDir: '../build' },
  plugins: [SsrBoost({ clientFile: 'client.ts', serverFile: 'server.ts' }), react()],
});
```

For stock Vite with root `.` use `clientFile: 'src/main.tsx'`, `serverFile: 'src/server.ts'` and `/src/main.tsx` in HTML. Keep the existing outDir; configure smoke and size checks for it. A project without TypeScript aliases can set `tsconfigAliases: false`.

## Shared wrapper and metadata

The template already has `src/app.tsx`; retain it and its imports. When adding a wrapper to a stock Vite SPA, use a distinct name such as `src/ssr-app.tsx` below, because `App.tsx` is the original page and `app.tsx` can collide with it on case-insensitive filesystems. Preserve existing StrictMode/provider nesting in the shared wrapper.

Install `@lomray/react-head-manager` and `isbot` if adding this integration to a SPA; init does not add them. Metadata state keys must match server and client.

```tsx
// src/ssr-app.tsx
import { MetaManagerProvider } from '@lomray/react-head-manager';
import type { Manager } from '@lomray/react-head-manager';
import type { FC, PropsWithChildren } from 'react';
import { StrictMode } from 'react';

interface AppProps {
  client?: { metaManager: Manager };
  server?: { metaManager: Manager };
}

const App: FC<PropsWithChildren<AppProps>> = ({ children, client, server }) => (
  <StrictMode>
    <MetaManagerProvider manager={(client?.metaManager ?? server?.metaManager)!}>
      {children}
    </MetaManagerProvider>
  </StrictMode>
);
export default App;
```

```ts
// src/client.ts (or retain src/main.tsx from init)
import { Manager } from '@lomray/react-head-manager';
import entryClient from '@lomray/vite-ssr-boost/browser/entry';
import getServerState from '@lomray/vite-ssr-boost/helpers/get-server-state';
import App from './ssr-app';
import routes from './routes';

void entryClient(App, routes, {
  init: async ({ isSSRMode }) => ({
    metaManager: new Manager(
      isSSRMode ? getServerState('metaManager', import.meta.env.PROD) : undefined,
    ),
  }),
});
```

`init` returns a Promise; its result reaches `App` as `client`. Read other snapshots and construct client stores here, never at module scope. Server props reach the same wrapper as `server`.

```ts
// src/server.ts
import { Manager } from '@lomray/react-head-manager';
import MetaServer from '@lomray/react-head-manager/server';
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';
import { isbot } from 'isbot';
import App from './ssr-app';
import routes from './routes';

export default entryServer(App, routes, {
  // Optional staged rollout: ssr: { mode: 'include', routes: ['/', '/deferred'] },
  init: () => ({
    // Optional: hydration: 'early', with all custom state ready at shell time.
    onRequest: () => ({ appProps: { metaManager: new Manager() } }),
    onRouterReady: ({ context: { request } }) => ({
      isStream: !isbot(request.headers.get('user-agent') ?? '') &&
        !/(?:^|;\s*)isCrawler=1(?:;|$)/.test(request.headers.get('cookie') ?? ''),
    }),
    onShellReady: ({ context: { appProps, html } }) => ({
      header: MetaServer.inject(html.header, appProps.metaManager),
    }),
    getState: ({ context: { appProps } }) => ({
      metaManager: MetaServer.getState(appProps.metaManager),
    }),
  }),
});
```

Use `<Meta><title>Page title</title><meta name="description" content="Page summary" /></Meta>` in route components (import `Meta` from `@lomray/react-head-manager`). Early mode collects metadata/custom state at shell readiness; slow-boundary mutations need a separate application strategy.

## Fetch createHandler for an application-owned Node server

The first argument contains renderer dependencies; the second contains lifecycle/options. Unlike managed entries, Fetch hooks are not wrapped in `init`. This factory accepts the built shell and route-asset preparation supplied by the transport; it does not start a server.

```tsx
// src/fetch-handler.tsx; keep outside the browser dependency graph.
import type { ComponentProps } from 'react';
import { createStaticHandler } from 'react-router';
import { Manager } from '@lomray/react-head-manager';
import MetaServer from '@lomray/react-head-manager/server';
import createHandler from '@lomray/vite-ssr-boost/core/handler';
import renderToStream from '@lomray/vite-ssr-boost/node/render-to-stream';
import App from './ssr-app';
import routes from './routes';

type Props = NonNullable<ComponentProps<typeof App>['server']>;
type Options = Parameters<typeof createHandler<Props>>[1];

export function makeHandler(getHtml: Options['getHtml'], prepare: Options['prepare']) {
  return createHandler<Props>(
    {
      handler: createStaticHandler(routes),
      createApp: (children, { appProps }) => <App server={appProps}>{children}</App>,
      renderToStream,
    },
    {
      getHtml,
      prepare,
      hydration: 'footer',
      abortDelay: 15_000,
      ssr: { mode: 'all' },
      onRequest: () => ({ appProps: { metaManager: new Manager() } }),
      onRouterReady: ({ context: { request } }) => ({
        isStream: !request.headers.get('user-agent')?.includes('Googlebot'),
      }),
      onShellReady: ({ context: { appProps, html } }) => ({
        header: MetaServer.inject(html.header, appProps.metaManager),
      }),
      getState: ({ context: { appProps } }) => ({
        metaManager: MetaServer.getState(appProps.metaManager),
      }),
    },
  );
}
```

At Node startup, supply `await loadHtmlShell({ indexFile: 'build/client/index.html' })` and `createRouteAssetPreparer({ buildDir: 'build' })` from `@lomray/vite-ssr-boost/node/production`, resolving paths against the launcher. Serve built client files before the SSR handler and connect `adapters/node`, `adapters/fastify` or your transport. The built shell must contain its real browser JS entry. An inline shell without client assets only proves server HTML.

For a basename, pass the same value to `createStaticHandler(routes, { basename })`, handler options, and browser `routerOptions`. Worker deployments use `cloudflare`/the edge renderer and bindings, not `node/production` or filesystem paths. See [runtime adapters](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/runtime-adapters.md), [server API](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/api/server-entry.md) and [browser API](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/api/browser-entry.md).
