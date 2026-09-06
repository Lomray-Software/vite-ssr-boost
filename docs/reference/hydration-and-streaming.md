# Hydration order and streaming

Hydration connects React to the HTML already rendered by the server. The browser needs the matching route code and serialized state before it creates the router and hydrates the root.

## Why the client can arrive first

In a production build, Vite emits the client entry as a module script in `<head>`. The [minimal example's HTML](/guide/migrate-existing-spa#src-index-html) marks that script `async`, so it can execute while the browser is still parsing the response. A module script without `async` normally waits for parsing to finish.

With a warm HTTP cache, the async module and its imports may be ready before the server finishes streaming the HTML. The footer contains the custom state scripts and the `window.__staticRouterHydrationData` script, so both can still be missing when the client entry runs.

Starting hydration at that point can produce this sequence:

1. React Router creates the browser router without hydration data. Routes whose loaders need to run can enter the initial fallback path, producing a `HydrateFallback` warning when no fallback is provided.
2. The browser's initial tree differs from the server HTML. React reports a hydration mismatch ([production error #418](https://react.dev/errors/418)) and regenerates the tree on the client.
3. The remaining server HTML arrives after React has taken over the root. The browser can append that late HTML alongside the client-rendered content, making the content appear twice.

These symptoms describe the timing failure; a hydration mismatch can also have other causes.

## The wait added in 8.0.0

[`src/browser/entry.tsx`](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/src/browser/entry.tsx) calls `waitForDocument()` before creating the router:

- It returns immediately when `document.readyState !== 'loading'`, or, in SSR mode, when `window.__staticRouterHydrationData` is already defined.
- Otherwise it waits for `DOMContentLoaded`. In SSR mode it also installs a temporary accessor on `window.__staticRouterHydrationData`.
- The first assignment to that accessor replaces it with a configurable, enumerable, writable plain data property holding the assigned value. It removes the `DOMContentLoaded` listener and resolves the wait.
- If `DOMContentLoaded` arrives first, the listener removes the temporary accessor in SSR mode and resolves the wait. Document readiness does not verify that a custom server actually sent state.

The entry starts preloading the matched lazy routes while it waits. It awaits document readiness and those preloads together with `Promise.all`, and copies each lazy route result onto the route object before calling `createRouter`. After that, it finds the root, runs the optional `init` callback and hydrates in SSR mode. SPA mode and roots marked `data-force-spa="1"` use `createRoot` instead.

## The footer order

[`src/core/render.tsx`](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/src/core/render.tsx) builds the footer in this order:

1. Custom state from `getState`.
2. Router state assigned to `window.__staticRouterHydrationData`.
3. The `onShellReady` footer override, or the template footer.

The composed response sends the header, the React body stream and then this footer. Assigning router state releases the browser entry's wait, so the custom state must already be available at that point. The entry's `init` callback can then read that state.

## Streamed loader and action data

The [data stream](/guide/data-streaming) publishes stable promise placeholders in router initialization. Settlement scripts can arrive before initialization or the async entry: `window.__ssrBoostStream` buffers frames until its receiver is installed. The entry decodes the initial state and reconstructs native promises before `createRouter`.

In default footer mode, custom state comes first in the footer, followed by the router hydration assignment and encoded initialization. Earlier settlement frames do not release the document wait. The assignment is an internal stream marker until the entry replaces it with decoded state.

With `hydration: 'early'`, custom state and router state are emitted in the shell block before React body bytes. `getState` must already have everything hydration needs at `onShellReady`. The entry waits for React's bootstrap script at the end of the parsed shell before hydrating; it then allows slow boundaries to finish independently. This works across split shell chunks and requires an async client module. `isStream: false` still waits for complete React HTML and resolved data and uses the footer.

## Custom servers and `onResponse`

Keep the generated state and settlement scripts in the same HTML response and complete it. Default mode keeps hydration state after the React body; early mode sends it with the shell. Do not send state in a separate request or withhold the final chunk. Replacing the footer through `onShellReady` preserves the generated state scripts and their order.

[`src/core/transform-html.ts`](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/src/core/transform-html.ts) applies `onResponse` to decoded HTML chunks:

| Return value             | For a chunk with `isEnd: false`                                         |
| ------------------------ | ----------------------------------------------------------------------- |
| `undefined` or no return | Keep the original chunk.                                                |
| A nonempty string        | Replace the chunk with that string.                                     |
| `''`                     | Withhold the chunk. A transform retaining content must return it later. |

After the body and footer have passed through the transform, it calls the hook once more with `html: ''` and `isEnd: true`. Return any retained content at that point; `undefined` or `''` appends nothing. If retained content includes state or closing HTML, discarding it can break hydration even with the browser wait.

See [Server Lifecycle](/guide/server-lifecycle#onresponse) for the hook contract and an incremental transform example.

## Reproduce the timing locally

Use a production build of an application, such as the [prod template](https://github.com/Lomray-Software/vite-template/tree/prod), behind a local proxy. Development mode changes script handling and does not reproduce the same timing.

1. Run `npm run build` and `npm run start:ssr` in the template. Use its listening address as the proxy's `UPSTREAM` below.
2. Choose a route with loader data and a streamed React body that stays open for more than a few hundred milliseconds, for example a component-level Suspense request. A slow loader alone delays the shell, so it does not create this interval. Keep streaming enabled for the browser request.
3. Save this proxy as `/tmp/ssr-timing-proxy.mjs`. It delays JavaScript module responses by 300 ms, leaves the HTML streaming and preserves the upstream cache headers.

```js
import http from 'node:http';

const upstream = new URL(process.env.UPSTREAM || 'http://127.0.0.1:3000');
const moduleDelay = Number(process.env.MODULE_DELAY_MS || 300);

http
  .createServer((request, response) => {
    const target = new URL(request.url, upstream);
    const upstreamRequest = http.request(
      target,
      {
        method: request.method,
        headers: { ...request.headers, host: upstream.host },
      },
      (upstreamResponse) => {
        const forward = () => {
          if (response.destroyed) return;
          response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        };

        if (/\.m?js$/.test(target.pathname)) {
          setTimeout(forward, moduleDelay);
        } else {
          forward();
        }
      },
    );

    upstreamRequest.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end('Production server unavailable');
    });
    response.on('close', () => upstreamRequest.destroy());
    request.pipe(upstreamRequest);
  })
  .listen(4174, '127.0.0.1');
```

```bash
UPSTREAM=http://127.0.0.1:3000 MODULE_DELAY_MS=300 node /tmp/ssr-timing-proxy.mjs
```

Open `http://127.0.0.1:4174` and navigate to the streamed route. Leave the browser's HTTP cache enabled, load once, then reload normally. Cached modules can bypass the proxy's delay on the second load. Adjust the module delay or the component's response time until the entry runs while `document.readyState` is `loading` and `window.__staticRouterHydrationData` is `undefined`. Delaying JavaScript alone is not enough if the whole HTML response has already arrived.

Use browser breakpoints at the start of the entry and at `createRouter` to inspect that order. With the 8.0.0 wait in place, router creation waits for the state assignment or `DOMContentLoaded`, and for matched lazy routes. The missing-state warning, mismatch and duplicate content describe an entry without that wait; the current entry should wait through this interval. Stop the proxy with Ctrl+C when finished.
