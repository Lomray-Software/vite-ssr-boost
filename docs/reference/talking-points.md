# Talking Points

## Short version

`@lomray/vite-ssr-boost` adds SSR to React Router apps in Data mode, without moving to Framework mode and without rewriting the app. Keep your Vite configuration, route objects and components, and build SSR or SPA output from the same application.

## Routing model

Data mode, not Framework mode. React Router's [mode guide](https://reactrouter.com/start/modes) describes the distinction; vite-ssr-boost uses `createStaticHandler` and `StaticRouterProvider` on the server and route objects in the browser.

## What you add

- `SsrBoost()` in the Vite plugin list.
- A browser entry for hydration or SPA mounting.
- A server entry at `@lomray/vite-ssr-boost/adapters/express/entry`.
- An HTML outlet and CLI scripts, shown in the [migration guide](/guide/migrate-existing-spa).

## Choose your server

The managed Express CLI is the default path for Vite development, HMR, static assets and route-asset injection. Use `createHandler` from `@lomray/vite-ssr-boost/core/handler` with the Node, Express, Fastify, Hono or edge adapter when you want to own the transport. That path also requires your development server, bundling and asset delivery; see [Runtime adapters](/guide/runtime-adapters).

## Data loading

Loader and action promises stream by default in Data mode. Return `{ fast, slow: fetchSlow() }` and consume `slow` inside Suspense with `<Await>` or React 19 `use()`. The browser reconstructs native promises before creating the router; client navigation loaders keep their native promises. See [Stream loader data](/guide/data-streaming) for the supported value matrix, errors and opt-in `hydration: 'early'`. Custom `getState` snapshots still use JSON.

The browser entry waits for document readiness or the router state assignment, together with matched lazy route preloads, before creating the router. Custom state is written before router state in the footer by default. `hydration: 'early'` publishes both at shell-ready and waits for React's parsed-shell marker; see [Hydration order and streaming](/reference/hydration-and-streaming) for the timing and the `onResponse` contract.

## Who this is for

- Teams adding SSR to a Vite app with React Router route objects.
- Teams that need SSR and SPA output from one app.
- Teams that own request handling and deployment decisions.

## When to choose another approach

The package does not implement RSC, Server Actions or file-system routing conventions. SSR still requires server ownership, whether you use the CLI or a Fetch transport. Use the [comparison guide](/guide/choosing) to evaluate those requirements and the [example projects](/examples/) to inspect application wiring.
