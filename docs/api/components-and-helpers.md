# Components And Helpers

## Components

### `Navigate`

```tsx
import Navigate from '@lomray/vite-ssr-boost/components/navigate';
```

Works like React Router navigation on the client, but on the server it writes a `Response` with `Location` and status.

Useful props:

- normal `NavigateProps`
- `status?: number` with default `301`

### `ResponseStatus`

```tsx
import ResponseStatus from '@lomray/vite-ssr-boost/components/response-status';
```

Sets the server response status from inside the route tree.

Example:

```tsx
<ResponseStatus status={404} />
```

### `ScrollToTop`

```tsx
import ScrollToTop from '@lomray/vite-ssr-boost/components/scroll-to-top';
```

Scrolls to top on pathname changes.

Prop:

- `shouldReloadReset?: boolean`

### `OnlyClient`

```tsx
import OnlyClient from '@lomray/vite-ssr-boost/components/only-client';
```

Loads and renders a component only on the client.

Props:

```ts
{
  load: () => Promise<{ default: ComponentType<T> } | ComponentType<T>>;
  children: (Component: ComponentType<T>) => ReactNode;
  fallback?: ReactNode;
  errorComponent?: ReactNode;
  isMemorized?: boolean;
}
```

Example:

```tsx
<OnlyClient load={() => import('./heavy-chart')}>
  {(Chart) => <Chart />}
</OnlyClient>
```

### `withSuspense`

```tsx
import withSuspense from '@lomray/vite-ssr-boost/components/with-suspense';
```

Wraps a component with a provided suspense boundary component and hoists non-React statics from the original component.

## Helpers

### `getServerState`

```ts
import getServerState from '@lomray/vite-ssr-boost/helpers/get-server-state';
```

Reads serialized server state written during SSR and exposed to the client.

Use it when `getState` in the server entry injects data that the browser should pick up during boot.

## Interfaces

Useful route-related imports:

```ts
import type { FCRoute, FCCRoute } from '@lomray/vite-ssr-boost/interfaces/fc-route';
import type { TRouteObject } from '@lomray/vite-ssr-boost/interfaces/route-object';
```

Use these when you want typed route components or route object declarations aligned with the package conventions.
