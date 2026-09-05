# Example projects

The [vite-template repository](https://github.com/Lomray-Software/vite-template) contains the application examples. Start with `example/minimal` for the entries used in the [migration guide](/guide/migrate-existing-spa), or choose `prod` for state management and deployment workflows.

Use `npm create @lomray/ssr-app@latest my-app -- --template <name>` to create an app from a branch: `full` selects `prod`, `minimal` (the default) selects `example/minimal`, `custom-server` selects `example/custom-server`, and `localization` selects `example/localization`. See [Create a new app](/guide/getting-started#create-a-new-app) for the flags.

## `prod`

The [prod branch](https://github.com/Lomray-Software/vite-template/tree/prod) combines a MobX manager, consistent-suspense, a route manager and meta tags. It includes component-level data streaming, Docker, Amplify and Vercel build scripts, and deployment workflows. Use it when the application needs the state and stream wiring shown in its server and client entries.

## `example/minimal`

The [minimal branch](https://github.com/Lomray-Software/vite-template/tree/example/minimal) has six direct runtime dependencies: React, React DOM, React Router, vite-ssr-boost, `@lomray/react-head-manager` and `isbot`. It demonstrates loaders, a lazy route with CSS, redirects, 404 responses, metadata and a browser-only route. Its README includes the five-file change from a Vite SPA.

## `example/custom-server`

The [custom-server branch](https://github.com/Lomray-Software/vite-template/tree/example/custom-server) uses the managed CLI in development and an application-owned Fastify 5 launcher in production. Its `server/index.mjs` serves assets with `@fastify/static`, connects SSR through `adapterFastify(handler, { compression: true })`, injects route assets and emits Early Hints. Its `src/server.ts` exports the managed entry as the default and a `createHandler` handler as a named export, sharing the app between both servers. See [Runtime adapters](/guide/runtime-adapters) for the transport responsibilities.

## `example/localization`

The [localization branch](https://github.com/Lomray-Software/vite-template/tree/example/localization) creates an i18next instance per request and selects the language from the `lang` cookie, then `Accept-Language`. The server sets `<html lang>` and transfers `{ language }` through `getState`; the client loads that language from bundled resources before hydration. A cookie-based switcher changes the language while keeping the server and browser in agreement.

## Data loading across examples

Follow the [data-loading contract](/guide/migrate-existing-spa#data-loading) for loader data at first paint and the Suspense pattern used for streamed data.

See [Recipes](/examples/recipes) for individual integrations.
