# Recipes

## Packages that import CSS during SSR

If Node reports `Unknown file extension ".css"` from a dependency, let Vite bundle that package:

```ts
export default defineConfig({
  ssr: { noExternal: ['the-package-that-imports-css'] },
});
```

## Keep server and browser state in sync

Create locale, authentication and store state per request. Serialize the initial values with
`getState`, then read them with `getServerState` before calling `entryClient`. Rendering a different
language or initial value in the browser causes hydration mismatches; log failures with `onError`.

## Change `basename`

Client:

```tsx
void entryClient(App, routes, {
  routerOptions: {
    basename: '/custom',
  },
});
```

Server:

```tsx
export default entryServer(App, routes, {
  routerOptions: {
    basename: '/custom',
  },
});
```

## Change static asset `base`

Vite config:

```ts
export default defineConfig({
  base: '/static',
});
```

Server entry:

```tsx
export default entryServer(App, routes, {
  middlewares: {
    expressStatic: {
      basename: '/static',
    },
  },
});
```

Keep these values aligned.

## Generate an extra SPA shell

```ts
export default defineConfig({
  plugins: [
    SsrBoost({
      spaIndex: true,
    }),
    react(),
  ],
});
```

This emits `index-spa.html`, which is useful for service worker routing such as `createHandlerBoundToURL("index-spa.html")`.

## Add a Capacitor or mobile entrypoint

Vite config:

```ts
export default defineConfig({
  plugins: [
    SsrBoost({
      entrypoint: [
        {
          name: 'mobile',
          type: 'spa',
          clientFile: './src/mobile.tsx',
          buildOptions: '--mode mobile',
        },
      ],
    }),
    react(),
  ],
});
```

Mobile entry:

```tsx
const AppMobile: FC = (props) => {
  return <App {...props} />;
};

void entryClient(AppMobile, routes, {});
```

## Redirect with server status

```tsx
return <Navigate to="/login" status={302} replace />;
```

On the server this produces a redirect response instead of only changing client navigation state.

## Set HTTP status from a route

```tsx
const NotFound = () => (
  <>
    <ResponseStatus status={404} />
    <h1>Page not found</h1>
  </>
);
```

## Load a widget only on the client

```tsx
<OnlyClient
  load={() => import('./MapWidget')}
  fallback={<div>Loading map...</div>}
>
  {(MapWidget) => <MapWidget />}
</OnlyClient>
```

Use this for browser-only integrations that should not participate in SSR.
