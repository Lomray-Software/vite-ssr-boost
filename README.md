# Vite SSR BOOST

SSR for React Router apps in [Data mode](https://reactrouter.com/start/modes), without moving to Framework mode and without rewriting the app. `@lomray/vite-ssr-boost` adds server rendering to your Vite project while keeping your route objects and components. Build SSR and SPA output from the same app, and choose a managed Express server or a Fetch handler for your own transport.

## Who this is for

- Teams adding SSR to a Vite SPA with React Router route objects.
- Teams that need server rendering and SPA output from one application.
- Teams that want to control request hooks, response headers and deployment.

## What you keep

- Your Vite configuration and plugins, with the SSR plugin added.
- Your React Router route objects.
- Your components, after removing browser globals from server execution.
- Your React version within the package's peer range: React and React DOM `>=18.2.0`.
- Your hosting choice, provided it can run the selected SSR transport or serve SPA files.

## What you add

Add `SsrBoost()` to the Vite plugins, wire `client.ts` and `server.ts`, and replace the Vite scripts with `ssr-boost` commands. The [migration guide](./docs/guide/migrate-existing-spa.md) includes these entries and the HTML outlet, copied from the minimal example.

## Choose your server

**Managed CLI (default).** Use `ssr-boost dev` for Express with Vite development and HMR, then `ssr-boost build` and `ssr-boost start` for production assets and SSR. The server entry is `@lomray/vite-ssr-boost/adapters/express/entry`, with hooks for requests, rendering and responses.

**Fetch handler.** Import `createHandler` from `@lomray/vite-ssr-boost/core/handler` and connect it through `adapters/node`, `adapters/express`, `adapters/fastify`, `adapters/hono` or `adapters/edge`. Your transport owns the development server, static assets and route-asset injection; follow [Runtime adapters](./docs/guide/runtime-adapters.md) when you need this control.

## Not a fit when

- You need an implementation of React Server Components and Server Actions.
- You want the package to impose file-system routing conventions.
- You want zero server ownership for SSR.

## Install and template quick start

```bash
npm i @lomray/vite-ssr-boost
```

The package declares `engines.node: ">=22.12.0"`. The example uses Node 22.23.2; React Router and build tools can raise the required Node version.

Start with the [minimal template](https://github.com/Lomray-Software/vite-template/tree/example/minimal): run `git clone --branch example/minimal https://github.com/Lomray-Software/vite-template.git`, then `cd vite-template`, `npm ci` and `npm run develop`. Its six direct runtime dependencies are React, React DOM, React Router, vite-ssr-boost, `@lomray/react-head-manager` and `isbot`.

For production, run `npm run build` and `npm run start:ssr`. For a SPA build, run `npm run build:spa` and `npm run start:spa`. See [Example projects](./docs/examples/index.md) for the `prod` template with state management and deployment workflows.

## Documentation

Read the [documentation site](https://lomray-software.github.io/vite-ssr-boost/), the [comparison guide](./docs/guide/choosing.md) and the [FAQ](./docs/reference/faq.md).

<p align="center">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=reliability_rating" alt="reliability">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=security_rating" alt="Security Rating">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=sqale_rating" alt="Maintainability Rating">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=vulnerabilities" alt="Vulnerabilities">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=bugs" alt="Bugs">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=ncloc" alt="Lines of Code">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=coverage" alt="code coverage">
  <img src="https://img.shields.io/npm/v/@lomray/vite-ssr-boost?label=semantic%20release&logo=semantic-release" alt="semantic version">
</p>

## License

Made with 💚

Published under [MIT License](./LICENSE).
