# Vite SSR BOOST

<p align="center"><img src="https://raw.githubusercontent.com/Lomray-Software/vite-ssr-boost/prod/logo.png" alt="Vite SSR BOOST logo" width="250" height="250"></p>

<p align="center">SSR for React Router apps in <a href="https://reactrouter.com/start/modes">Data mode</a>, without moving to Framework mode and without rewriting the app.</p>

<p align="center">
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=reliability_rating" alt="Reliability Rating"></a>
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=security_rating" alt="Security Rating"></a>
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=sqale_rating" alt="Maintainability Rating"></a>
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=vulnerabilities" alt="Vulnerabilities"></a>
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=bugs" alt="Bugs"></a>
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=ncloc" alt="Lines of Code"></a>
  <a href="https://sonarcloud.io/dashboard?id=vite-ssr-boost"><img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&amp;metric=coverage" alt="Code Coverage"></a>
  <a href="https://www.npmjs.com/package/@lomray/vite-ssr-boost"><img src="https://img.shields.io/npm/v/@lomray/vite-ssr-boost?label=semantic%20release&amp;logo=semantic-release" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@lomray/vite-ssr-boost"><img src="https://img.shields.io/npm/dm/@lomray/vite-ssr-boost" alt="npm monthly downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@lomray/vite-ssr-boost" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/@lomray/vite-ssr-boost"><img src="https://img.shields.io/node/v/@lomray/vite-ssr-boost" alt="Node version requirement"></a>
</p>

## Quick start

**Add to an existing app:**

```bash
npm i @lomray/vite-ssr-boost
npx ssr-boost init --dry-run
npx ssr-boost init --apply
npm install
npx ssr-boost doctor
```

`@lomray/vite-ssr-boost` adds server rendering to your Vite project while keeping your route objects and components. Build SSR and SPA output from the same app, and choose a managed Express server or a Fetch handler for your own transport.

The [migration guide](./docs/guide/migrate-existing-spa.md) walks through the five-file change:

| File             | Change                                               |
| ---------------- | ---------------------------------------------------- |
| `vite.config.ts` | Add `SsrBoost()` to the plugins.                     |
| `src/index.html` | Add the SSR outlet inside the root element.          |
| `src/client.ts`  | Use the browser entry for hydration or SPA mounting. |
| `src/server.ts`  | Add the server entry and request-scoped setup.       |
| `package.json`   | Use the `ssr-boost` dev, build and start commands.   |

**Start a new app** with the `minimal` template (default):

```bash
npm create @lomray/ssr-app@latest my-app
```

Choose the `full` template by passing the flag after `--`:

```bash
npm create @lomray/ssr-app@latest my-app -- --template full
```

Starting a new app? Choose one of the [template branches](./docs/examples/index.md) with the [`npm create` command](./docs/guide/getting-started.md#create-a-new-app) or clone the branch directly.

To defer loader work, return `{ title, slow: fetchUsers() }` and render `slow` with Suspense and `<Await>`; see the [streaming guide](./docs/guide/data-streaming.md).

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

Loader and action promises support `<Await>` and React 19 `use()` during hydration by default. [Stream loader data](./docs/guide/data-streaming.md) shows the loader pattern and `hydration: 'early'` for shell interaction before slow boundaries finish.

## What you add

Add `SsrBoost()` to the Vite plugins, wire `client.ts` and `server.ts`, and replace the Vite scripts with `ssr-boost` commands. The [migration guide](./docs/guide/migrate-existing-spa.md) includes these entries and the HTML outlet, copied from the minimal example.

Deferred router data needs no additional state library. Keep footer hydration by default, or opt into early hydration with custom state available at `onShellReady`.

## Choose your server

**Managed CLI (default).** Use `ssr-boost dev` for Express with Vite development and HMR, then `ssr-boost build` and `ssr-boost start` for production assets and SSR. The server entry is `@lomray/vite-ssr-boost/adapters/express/entry`, with hooks for requests, rendering and responses.

**Fetch handler.** Import `createHandler` from `@lomray/vite-ssr-boost/core/handler` and connect it through `adapters/node`, `adapters/express`, `adapters/fastify`, `adapters/hono` or `adapters/edge`. Your transport owns the development server, static assets and route-asset injection; follow [Runtime adapters](./docs/guide/runtime-adapters.md) when you need this control.

## Not a fit when

- You need an implementation of React Server Components and Server Actions.
- You want the package to impose file-system routing conventions.
- You want zero server ownership for SSR.

## Install and template quick start

See [Compatibility](#compatibility) for the package Node requirement. The example uses Node 22.23.2; React Router and build tools can raise the required Node version.

Start with the [minimal template](https://github.com/Lomray-Software/vite-template/tree/example/minimal):

```bash
npm create @lomray/ssr-app@latest my-app
cd my-app
npm run develop
```

Or clone the template branch directly:

```bash
git clone --branch example/minimal https://github.com/Lomray-Software/vite-template.git
cd vite-template
npm ci
npm run develop
```

Its six direct runtime dependencies are React, React DOM, React Router, vite-ssr-boost, `@lomray/react-head-manager` and `isbot`.

For production, run `npm run build` and `npm run start:ssr`. For a SPA build, run `npm run build:spa` and `npm run start:spa`. See [Example projects](./docs/examples/index.md) for the `prod` template with state management and deployment workflows.

Already running this in production? Point our [free performance audit](https://audit.lomray.com/?utm_source=github&utm_medium=readme-vite-ssr-boost&utm_campaign=owned-surface-github) at the URL. It reports Core Web Vitals, JavaScript bundle weight and whether the HTML really arrives server-rendered. No signup.

## Compatibility

See the [support policy](./SUPPORT.md) for version lifetimes, response targets and breaking-change commitments, and [Upgrade from 7 to 8](./docs/guide/upgrade-v8.md) for migration instructions.

The package is tested against the current and previous major of React, React Router and Vite, with an additional Vite 6 row. The [compatibility workflow](./.github/workflows/react-compatibility.yml) runs the full test suite and a built Worker check on Node 22.23.2 with these exact combinations:

| React / React DOM | React Router | Vite    |
| ----------------- | ------------ | ------- |
| `18.2.0`          | `7.18.3`     | `6.4.3` |
| `19.2.8`          | `7.18.3`     | `7.3.6` |
| `19.2.8`          | `8.3.1`      | `8.2.2` |

[package.json](./package.json) declares Node `>=22.12.0` and these peer ranges:

| Peer           | Range      |
| -------------- | ---------- |
| `react`        | `>=18.2.0` |
| `react-dom`    | `>=18.2.0` |
| `react-router` | `>=7.0.1`  |
| `vite`         | `>=5`      |

Peer ranges allow installation; the matrix tests only the combinations above. It does not test every version in those ranges or every combination of majors.

## Examples

The [example projects guide](./docs/examples/index.md) explains the wiring in each template branch.

| Template branch                                                                                        | What it includes                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`prod`](https://github.com/Lomray-Software/vite-template/tree/prod)                                   | MobX state management, component-level data streaming, metadata and deployment workflows.                                                   |
| [`example/minimal`](https://github.com/Lomray-Software/vite-template/tree/example/minimal)             | Six runtime dependencies, loaders, a lazy route with CSS, redirects, 404s, metadata and a browser-only route.                               |
| [`example/custom-server`](https://github.com/Lomray-Software/vite-template/tree/example/custom-server) | Managed CLI development and an application-owned Fastify 5 production server with static assets, compression, route assets and Early Hints. |
| [`example/localization`](https://github.com/Lomray-Software/vite-template/tree/example/localization)   | Per-request i18next, cookie and header language selection, and language state restored before hydration.                                    |

## Documentation

- [Documentation site](https://lomray-software.github.io/vite-ssr-boost/), [comparison guide](./docs/guide/choosing.md) and [FAQ](./docs/reference/faq.md).
- [Hydration order and streaming](./docs/reference/hydration-and-streaming.md).
- API: [Plugin](./docs/api/plugin.md), [Browser entry](./docs/api/browser-entry.md), [Server entry](./docs/api/server-entry.md), [Node production](./docs/api/node-production.md), [Components and helpers](./docs/api/components-and-helpers.md) and [CLI](./docs/api/cli.md).

## License

Made with 💚

Published under [MIT License](./LICENSE).
