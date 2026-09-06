# Routing

## Routing model

The package is built around React Router route objects.

Client side:

- matched lazy routes are resolved before router creation
- the browser router is created with your `routerOptions`

Server side:

- routes go through `createStaticHandler`
- the request is translated into a fetch request
- the static router renders through `StaticRouterProvider`

The point is simple: you keep React Router as the routing source of truth.

## Supported route declaration patterns

Supported:

```tsx
import type { RouteObject } from 'react-router';
import HomePage from './pages/home';

const routes: RouteObject[] = [
  {
    path: '/home',
    Component: HomePage,
  },
  {
    path: '/layout',
    element: <AppLayout />,
  },
  {
    path: '/lazy',
    lazy: () => import('./pages/lazy'),
  },
];
```

The routes array may be typed with `satisfies TRouteObject[]` or `as TRouteObject[]`.

Not recommended for route analysis:

```tsx
const importPath = './pages/home';

const routes = [
  {
    path: '/home',
    lazy: () => import(importPath),
  },
];
```

If route import detection matters for your build flow, keep lazy imports statically analyzable.

## Loader and action promises

Return promises for slow fields, such as `{ title, slow: fetchUsers() }`, and render them inside Suspense with `<Await>` or React 19 `use()`. The server streams their settlements and the browser reconstructs promises before router creation. See [Stream loader data](/guide/data-streaming), including `hydration: 'early'` for shell interaction while boundaries are pending. Keep loaders usable in the browser for client navigations.

## `routesPath`

`routesPath` helps the plugin detect where route declarations live. Use it when your route files are not obvious from the default project shape.

Example:

```ts
SsrBoost({
  routesPath: '/routes/',
});
```

## `basename`

Client side:

```tsx
void entryClient(App, routes, {
  routerOptions: {
    basename: '/custom',
  },
});
```

Server side:

```tsx
export default entryServer(App, routes, {
  routerOptions: {
    basename: '/custom',
  },
});
```

If you also serve static assets from a custom Vite `base`, keep your server static middleware aligned with it.

## Redirects and statuses inside routes

Use built-in components when a route should control the HTTP response:

- `Navigate` for redirects with server support
- `ResponseStatus` for explicit status codes

That gives you a React-level API while still writing the actual `Response` in server context.
