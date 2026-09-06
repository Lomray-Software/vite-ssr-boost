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

Arrays and route objects can be wrapped with `satisfies`, `as`, parentheses or non-null assertions. The parser follows default and named import aliases, including `import boot from '.../browser/entry'` and `import { entry as boot } from '.../browser/entry'`. Both call `boot(App, routes)`.

Shared static objects, literal computed keys, explicit IDs, and imported child arrays are supported:

```tsx
import { childRoutes as children } from './children';

const shared = { handle: { title: 'Account' } };
export default [
  { ...shared, ['id']: 'account', path: '/account', children },
] satisfies import('react-router').RouteObject[];
```

Object spreads follow JavaScript override order. Static bindings and named re-exports are resolved across local modules and Vite aliases. Explicit `id` values are used for assets; generated IDs retain the original array positions, including below explicitly named parents. Routes without asset imports never renumber their siblings.

Lazy values can be arrow functions or function expressions returning one literal `import()`, with optional `async`/`await` or `.then()` to select the module's `Component`. For example:

```tsx
{ path: '/account', lazy: async function () { return await import('./pages/account'); } }
{ path: '/account', lazy: () => import('./pages/account').then(m => ({ Component: m.Account })) }
```

Runtime route factories, array spreads, computed keys that are not string literals, non-static IDs, cycles, conditional children and non-literal or multiple lazy imports produce one error naming the file, line and construct. Dynamic path helpers remain supported because paths do not select asset modules; doctor represents those paths as `null` in support bundles instead of executing application code.

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
