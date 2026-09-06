# Stream loader data

Loader and action promises stream to the browser by default in React Router **Data mode**. Return critical data immediately and leave slower fields as promises. Both `<Await>` and React 19 `use()` receive native promises during hydration. Client navigations run your loaders in the browser, where their promises remain native.

## Return a promise

```tsx
import { Suspense } from 'react';
import { Await, useLoaderData } from 'react-router';

export function loader() {
  return {
    title: 'Deferred',
    slow: new Promise<{ users: number }>((resolve) => {
      setTimeout(() => resolve({ users: 3 }), 1500);
    }),
  };
}

export default function DeferredPage() {
  const data = useLoaderData() as ReturnType<typeof loader>;
  return (
    <main>
      <h1>{data.title}</h1>
      <Suspense fallback={<p>Loading users…</p>}>
        <Await resolve={data.slow} errorElement={<p>Could not load users.</p>}>
          {(value) => <p>Users: {value.users}</p>}
        </Await>
      </Suspense>
    </main>
  );
}
```

The same structure works in an `action`, read with `useActionData()`. React Router awaits the loader/action's own return promise before rendering: return an object containing a promise to defer a field. The transport also handles a promise at the root of an individual `loaderData` or `actionData` entry, promises nested in plain objects and arrays, and promises introduced by resolved values, including further nesting. Repeated references to a promise share one browser promise within that response.

For real requests, pass the loader's `request.signal` to `fetch`. Keep loader code usable during client navigation; put server-only work behind an API. Attach rejection handlers to work that might reject **before** `staticHandler.query()` finishes; transport handlers are installed after the query.

This follows React Router's [Suspense usage](https://reactrouter.com/how-to/suspense) and [custom Data framework architecture](https://reactrouter.com/start/data/custom).

## React 19 `use()`

Keep the consumer inside its Suspense boundary:

```tsx
import { Suspense, use } from 'react';
import { useLoaderData } from 'react-router';

function Users({ promise }: { promise: Promise<{ users: number }> }) {
  const value = use(promise);
  return <p>Users: {value.users}</p>;
}

export default function DeferredPage() {
  const data = useLoaderData() as { slow: Promise<{ users: number }> };
  return (
    <Suspense fallback={<p>Loading users…</p>}>
      <Users promise={data.slow} />
    </Suspense>
  );
}
```

Use `<Await>` on React 18. Rejected `use()` promises go to the nearest React error boundary; `<Await errorElement>` can render local failure UI and `useAsyncError()` reads its rejection.

## Supported values

Initial router data and every streamed resolution use the same [devalue](https://github.com/sveltejs/devalue) value codec, with custom promise and error reducers. The transport does not depend on React Router's internal codec exports.

| Value | Browser result |
| --- | --- |
| JSON primitives, plain objects, arrays | Same values; own string keys are preserved, including `__proto__`. |
| `undefined` | Preserved in objects and arrays. |
| `Date` | A `Date`, including invalid dates. |
| `Map`, `Set` | Native collections, with recursively decoded keys and values. |
| `bigint` | A `bigint`, without numeric precision loss. |
| `RegExp` | Same source and flags; `lastIndex` resets to zero. |
| `NaN`, positive/negative infinity, `-0`, sparse arrays | Preserved by the codec. |
| `Promise` | One native promise per request-local identity. |
| Errors and route error responses | The fields described below; arbitrary custom properties are omitted. |
| Functions, symbols, other class instances, WeakMap/WeakSet | Unsupported; diagnostics warn and these values decode as `undefined`. |
| Circular references | Outside the supported contract; diagnostics warn even where the codec can preserve a cycle. Prefer acyclic route data. |

Object identity is preserved within a value frame. Across separate settlement frames only promise identity is guaranteed. Codec features beyond this table, such as typed arrays and arbitrary custom types, are not part of the router-data contract. `getState` continues to use **JSON**, so its custom state must contain plain snapshots with no promises or rich values.

## Rejections and aborts

Ordinary errors retain `message` and `name`. React Router error responses and rejected `data(value, { status, statusText })` values retain `message`, `status`, `statusText` and `data`; reconstructed response errors also satisfy `isRouteErrorResponse`. Stacks are sent only when diagnostics are enabled. Rejections after the shell was sent cannot change the HTTP status.

`abortDelay` defaults to 15 seconds and starts after routing/preparation. It remains active until both React and pending loader/action promises finish, including promises the component never reads. On timeout, pending browser promises reject with `SSR loader/action promise aborted before it settled.` before the response closes. Development diagnostics report `SSR_BOOST_STREAM_PROMISE_ABORTED`. Disconnects cancel rendering and discard queued data when the consumer is gone. Aborting the render does not stop arbitrary application promises; use request cancellation for their underlying work.

## Hydrate the shell early

Opt in on the managed entry's lifecycle configuration:

```ts
export default entryServer(App, routes, {
  init: () => ({
    hydration: 'early',
    getState: ({ context }) => ({ app: { locale: context.appProps.locale } }),
  }),
});
```

For a Fetch handler, pass `hydration: 'early'` alongside `getHtml` and other `createHandler` options. Use an **async** client module script (`<script type="module" src="/client.ts" async>`); an ordinary module waits for the HTML response to finish parsing. Static assets, matched lazy modules and the client's `init` callback must also load quickly enough for early interaction.

Early mode collects `getState` at `onShellReady`, sends custom state first and router state next in the initial shell block before React's body bytes, and waits for React's bootstrap marker at the end of the parsed shell before hydrating. Slow boundaries can still be pending while a shell button responds. Keep state local to shell controls; on React 18, wrap updates that change a still-hydrating boundary in `startTransition` to avoid forcing that boundary to client rendering.

**Custom state needed for hydration must be available at `onShellReady`.** State created only when a slow boundary resolves needs the application's own state transport. Selective hydration cannot compensate for missing initial custom state. React's bootstrap marker prevents hydration of a partially parsed shell, even if that shell spans multiple network chunks.

The default is `hydration: 'footer'`: custom state and router hydration state stay in the footer, in that order. Settlements can arrive before that initialization and before the entry; the queue retains them without starting hydration.

## Bots, adapters and limits

Choose buffered output for crawlers with the existing hook:

```ts
onRouterReady: ({ context: { request } }) => ({
  isStream: !request.headers.get('user-agent')?.includes('Googlebot'),
}),
```

`isStream: false` waits for all React boundaries and all router promises, then sends complete HTML with resolved data frames in the footer. Successful buffered renders have no pending `<!--$?-->` Suspense markers. This overrides early hydration timing. Bot detection remains your application's choice.

The shared transport works with Node, managed Express, the Express Fetch adapter, Fastify, Hono and edge renderers. It reads React only under response demand and preserves cancellation. Inline state and settlement scripts escape HTML delimiters and U+2028/U+2029; the `nonce` render option is forwarded to React and every generated custom-state/router-data script. `bootstrapScriptContent` is also forwarded to React; early mode prefixes its shell marker to it. Supply trusted JavaScript only for that option.

Keep all generated scripts and closing HTML in `onResponse` transforms. Proxies or compression buffers can delay browser interactivity even though the server emits the shell early. See [Hydration order and streaming](/reference/hydration-and-streaming) and [Server lifecycle](/guide/server-lifecycle).
