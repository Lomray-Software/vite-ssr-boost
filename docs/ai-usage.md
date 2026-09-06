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
- Node production helpers: `@lomray/vite-ssr-boost/node/production`.
- CLI binary: `ssr-boost`.

## Default workflow and transport ownership

Prefer the managed CLI for Vite development, HMR, asset manifests and production static files. It uses Express, and managed request/render hooks retain the live Express `req` and `res` objects. `node/entry` was removed in 8.0.0; use `adapters/express/entry` for v8 and follow [Upgrade from 7 to 8](/guide/upgrade-v8).

A Fetch transport owns its development server, bundling, static assets and route-asset injection. It can initialize `ServerConfig` from `@lomray/vite-ssr-boost/services/server-config` and inject manifest assets with `SsrManifest` from `@lomray/vite-ssr-boost/services/ssr-manifest`; see [Runtime adapters](/guide/runtime-adapters). The [custom-server example](https://github.com/Lomray-Software/vite-template/tree/example/custom-server) demonstrates this integration with Fastify in production and the managed CLI in development.

## Data loading contract

Loader and action promises stream by default in Data mode. Return `{ fast, slow: fetchSlow() }` and consume `slow` inside Suspense with `<Await>` or React 19 `use()`. The browser reconstructs native promises before creating the router; client navigation loaders keep their native promises. See [Stream loader data](/guide/data-streaming) for the supported value matrix, errors and opt-in `hydration: 'early'`. Custom `getState` snapshots still use JSON.

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
- Rendering and pending router promises abort on timeout or request cancellation.
- Early hydration requires an async client entry and custom state available at `onShellReady`; buffered bot rendering waits for all promises.
- CLI focus selection uses `--focus-only`; use `--focus-only client` for SPA build and start.
- Plugin `entrypoint` configures additional build surfaces.
- The package does not implement RSC, Server Actions or file-system routing conventions.
- Use the [comparison guide](/guide/choosing) and its official sources for claims about other projects.

## Machine-readable documentation

The docs build generates [llms.txt](https://lomray-software.github.io/vite-ssr-boost/llms.txt) and [llms-full.txt](https://lomray-software.github.io/vite-ssr-boost/llms-full.txt) from the Markdown sources. The short file includes the package identity, the resolved release version when available, the public entrypoints and data-loading contract from this page, and an absolute URL for every documentation page. The full file concatenates those pages with their source URLs.

Run `npm run docs:build` to regenerate both files in `docs/.vitepress/dist`. The version comes from `git describe --tags --match 'v*' --abbrev=0`, with the leading `v` removed. If tags are unavailable, the build falls back to `npm view @lomray/vite-ssr-boost version`; if that also fails, it omits the version line. The build reports which source it used. The docs workflow fetches full Git history and tags so CI can use the tag path. The source manifest's placeholder version is never used; semantic-release assigns the published package version in `lib/package.json` separately.

Generation checks that every indexed URL has a built HTML page and reports the page/link counts. GitHub Pages deploys these files with the rest of the docs; generated copies are not checked in.

## Keeping the Context7 index fresh

[`context7.json`](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/context7.json) selects the `prod` branch and `docs/`. Context7 also includes root Markdown automatically; the filename exclusions leave `README.md` as the root source. Tests, scripts, package output and non-documentation examples are excluded, while `docs/examples/` stays indexed. The rules identify the v8 entrypoints and the removed `node/entry` path. The `v7.1.0` tag is configured as a separate previous version for v7 users. See the [Context7 configuration guide](https://context7.com/docs/library-owners).

Maintainers set the optional repository Actions secret `CONTEXT7_API_KEY`. The [refresh workflow](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/.github/workflows/context7-refresh.yml) calls the [documented refresh API](https://context7.com/docs/integrations/github-actions) on published releases or manual dispatch. The `prod` release job also calls it as a reusable workflow: [events created with `GITHUB_TOKEN` do not start another workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). This also refreshes docs-only changes after a successful `prod` release job.

The API step uses a job environment variable in its condition, following [GitHub's optional-secret pattern](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), so a missing key skips the request. The request refreshes the library's configured source; `context7.json` selects `prod`, so publishing a prerelease does not switch the main index to `staging`. After promoting documentation to `prod`, maintainers can dispatch the workflow to retry a failed refresh or refresh without a release. Check the workflow result and the [Context7 listing](https://context7.com/lomray-software/vite-ssr-boost) after indexing completes; a successful API request queues refresh work and does not prove parsing has finished.
