# Browser Entry

## Import

```ts
import entryClient from '@lomray/vite-ssr-boost/browser/entry';
```

## Signature

```ts
entryClient(App, routes, options?)
```

Options:

```ts
interface IEntryClientOptions<T> {
  init?: (params: {
    isSSRMode: boolean;
    router: DataRouter;
  }) => Promise<T>;
  routerOptions?: Parameters<typeof createBrowserRouter>[1];
  createRouter?: typeof createBrowserRouter;
  rootId?: string;
}
```

## What it does

While the document is loading, the entry waits for serialized router state (SSR only) or `DOMContentLoaded` before creating the router and rendering.

The browser entry:

- resolves currently matched lazy routes before router creation
- creates the browser router
- runs optional async initialization
- either hydrates SSR HTML or mounts a pure SPA root

That lazy-route preload step is important. It keeps SSR hydration from diverging when a route module was lazy on the server but not yet loaded on the client.

## `init`

Use `init` to create client-only props for your top-level app wrapper.

```tsx
void entryClient(App, routes, {
  init: async ({ isSSRMode, router }) => ({
    isSSRMode,
    pathname: router.state.location.pathname,
  }),
});
```

Those values are passed to `App` as `client`.

## `createRouter`

The default is `createBrowserRouter`.

Override it when your app uses a wrapped router factory from another integration, such as monitoring or instrumentation tooling.

## `rootId`

Defaults to `root`.

Change it only if your HTML template uses a different root node id.
