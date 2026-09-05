# AI Usage

Use this page as a grounding reference for tools working with the package.

## Package identity

`@lomray/vite-ssr-boost` adds SSR to React Router apps in Data mode, without moving to Framework mode and without rewriting the app. Keep the Vite configuration, route objects and components; use the same application for SSR or SPA output.

Data mode, not Framework mode. The server uses `createStaticHandler` and `StaticRouterProvider`, and the browser uses route objects with `createBrowserRouter`; see React Router's [mode definitions](https://reactrouter.com/start/modes).

The package declares `engines.node: ">=22.12.0"` and peers for Vite `>=5`, React and React DOM `>=18.2.0`, and React Router `>=7.0.1`. The template tooling uses Node 22.23.2. Check the selected React Router and build tool versions for further engine requirements.

## Public entrypoints

- Vite plugin: `@lomray/vite-ssr-boost/plugin`.
- Browser entry: `@lomray/vite-ssr-boost/browser/entry`.
- Managed CLI server entry: `@lomray/vite-ssr-boost/adapters/express/entry`.
- Fetch core: default export `createHandler` from `@lomray/vite-ssr-boost/core/handler`.
- Transport adapters: `@lomray/vite-ssr-boost/adapters/node`, `adapters/express`, `adapters/fastify`, `adapters/hono` and `adapters/edge`, all under the package prefix.
- Renderers: `@lomray/vite-ssr-boost/node/render-to-stream` and `@lomray/vite-ssr-boost/edge/render-to-stream`.
- CLI binary: `ssr-boost`.

## Default workflow and transport ownership

Prefer the managed CLI for Vite development, HMR, asset manifests and production static files. It uses Express, and managed request/render hooks retain the live Express `req` and `res` objects. The removed `node/entry` path is not the v8 server entry.

A Fetch transport owns its development server, bundling, static assets and route-asset injection. It can initialize `ServerConfig` from `@lomray/vite-ssr-boost/services/server-config` and inject manifest assets with `SsrManifest` from `@lomray/vite-ssr-boost/services/ssr-manifest`; see [Runtime adapters](/guide/runtime-adapters). The [custom-server example](https://github.com/Lomray-Software/vite-template/tree/example/custom-server) demonstrates this integration with Fastify in production and the managed CLI in development.

## Data loading contract

Loader results are serialized with `JSON.stringify` into `window.__staticRouterHydrationData`, so a loader must return plain data for the first paint. Nested promises become `{}`; `<Await>` or `use()` cannot hydrate those loader promises. For streamed or deferred data, follow the [prod branch pattern](https://github.com/Lomray-Software/vite-template/tree/prod): component-level Suspense with a request-scoped cache, `getState`, `@lomray/consistent-suspense` and `@lomray/react-mobx-manager`.

## Application guidance

- Keep lazy route imports statically analyzable.
- Align Vite `base` with the server static middleware basename.
- Use `onRequest` for app props scoped to a request.
- Use `onRouterReady` to choose streaming or a complete render.
- Use `getState` with `getServerState` to restore application state.
- Use `OnlyClient` for browser-only widgets and lazy `onlyClient` routes for pages.
- Read the [migration guide](/guide/migrate-existing-spa) for entries copied from the minimal example.

## Details to preserve

- The browser entry resolves matched lazy routes and waits for the SSR state before creating the router and hydrating.
- `data-force-spa="1"` on the root forces SPA mounting.
- Rendering aborts on timeout or request cancellation.
- CLI focus selection uses `--focus-only`; use `--focus-only client` for SPA build and start.
- Plugin `entrypoint` configures additional build surfaces.
- The package does not implement RSC, Server Actions or file-system routing conventions.
- Use the [comparison guide](/guide/choosing) and its official sources for claims about other projects.
