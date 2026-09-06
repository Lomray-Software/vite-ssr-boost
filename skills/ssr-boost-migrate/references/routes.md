# Routes and streamed data

## Before init: React Router Data mode

For a fresh Vite react-ts SPA, install `react-router@7`, keep the existing App page, and replace the direct App mount with this bootstrap. Existing apps should map their current route tree instead.

```tsx
// src/routes.ts
import type { RouteObject } from 'react-router';
import App from './App';

const routes = [
  { id: 'home', path: '/', Component: App },
] satisfies RouteObject[];
export default routes;
```

```tsx
// src/main.tsx BEFORE init
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import routes from './routes';
import './index.css';

const router = createBrowserRouter(routes);
createRoot(document.getElementById('root')!).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
);
```

After init, the App **page** remains in the route array; the entry's App **wrapper** renders its `children`. Do not pass the page that ignores children as the entry wrapper.

## Deferred route

Add a literal lazy route to the existing array: `{ id: 'deferred', path: '/deferred', lazy: () => import('./pages/deferred') }`. In the minimal template the route already exists; preserve its content and add the browser observation marker to its resolved `<ul>` instead of replacing the page. The standalone example below gives a migrated SPA the same observable contract.

```tsx
// src/pages/deferred.tsx; use index.tsx if matching the template layout.
import { Suspense, useState } from 'react';
import { Await, useLoaderData } from 'react-router';

export function loader() {
  return {
    title: 'Deferred data',
    users: new Promise<string[]>((resolve) => {
      setTimeout(() => resolve(['Ada Lovelace']), 1500);
    }),
  };
}

export function Component() {
  const data = useLoaderData() as ReturnType<typeof loader>;
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>{data.title}</h1>
      <button type="button" onClick={() => setCount((value) => value + 1)}>Count: {count}</button>
      <Suspense fallback={<p>Loading users</p>}>
        <Await resolve={data.users} errorElement={<p role="alert">Could not load users.</p>}>
          {(users: string[]) => <ul data-resolved>{users.map((name) => <li key={name}>{name}</li>)}</ul>}
        </Await>
      </Suspense>
    </main>
  );
}
```

Return `{ users: promise }`, not `await promise` as the entire loader result: React Router awaits the loader's outer promise before rendering. Timers above simulate I/O. For real work call a browser-accessible API with `fetch(new URL('/api/users', request.url), { signal: request.signal })` and check `response.ok` before decoding. If work may reject before the static query completes, attach an early rejection handler while retaining the original promise for error UI.

Router data supports promises, Date, Map, Set, bigint, RegExp and undefined. Functions, custom classes and cycles are outside the supported contract. Custom `getState` uses JSON and has stricter rules. `<Await>` works on React 18/19; React 19 `use(promise)` needs a Suspense consumer and an error boundary.

If the app's Fast Refresh lint rule rejects exporting a loader beside a component, move `loader` unchanged to `src/pages/deferred-loader.ts`. Import it as a type in the component (`import type { loader } from './deferred-loader'`) for `ReturnType`, and import it as a value in the route array:

```ts
import { loader as deferredLoader } from './pages/deferred-loader';
// Inside the existing route array:
{ id: 'deferred', path: '/deferred', loader: deferredLoader, lazy: () => import('./pages/deferred') },
```

The lazy file then exports only `Component`. Keep route arrays in `.ts` when they contain no JSX, and name the array before exporting it. This preserves the app's Fast Refresh checks without weakening lint rules.

## Actions and statuses

```tsx
// A route module; its /api/profile endpoint must be implemented by your application.
import { Form, redirect } from 'react-router';
import type { ActionFunctionArgs } from 'react-router';

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const result = await fetch(new URL('/api/profile', request.url), {
    method: 'POST',
    body: form,
    signal: request.signal,
  });
  if (!result.ok) throw new Response('Could not save profile', { status: result.status });
  return redirect('/profile');
}

export function Component() {
  return <Form method="post"><input name="name" /><button type="submit">Save</button></Form>;
}
```

The API must authenticate the request; an SSR same-origin fetch does not forward the incoming cookies automatically. Pass only credentials needed by your own API on the server, and keep secrets out of shared route modules. Stream noncritical action fields with an object containing promises and `useActionData`/`Await`, using the same loader contract.

Use `throw new Response('Not found', { status: 404 })` for missing resources and `redirect('/target', 302)` for HTTP redirects. When adding a catch-all component, preserve the template's `ResponseStatus` behavior so the server does not turn missing pages into 200s. Keep static route IDs/arrays and literal lazy imports; do not generate routes with runtime factories or array spreads.

See [routing](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/routing.md), [streaming](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/data-streaming.md), and [testing](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/testing.md).
