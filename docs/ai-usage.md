# AI Usage

Use this page as a grounding reference for tools working with the package.

## AI agents

Two [Agent Skills](https://agentskills.io/specification) are available: `ssr-boost-migrate` for an existing Vite SPA and `ssr-boost-new-app` for a new application. They include entry/data references and verification scripts.

**Claude Code** — install the [plugin](https://code.claude.com/docs/en/plugins):

```sh
claude plugin marketplace add Lomray-Software/vite-ssr-boost
claude plugin install ssr-boost@lomray
```

Invoke `/ssr-boost:ssr-boost-migrate` or `/ssr-boost:ssr-boost-new-app`. The GitHub install uses the repository's default branch; it requires the skill files to be present there. To try a checkout before release, run `claude --plugin-dir /absolute/path/to/vite-ssr-boost`.

**Codex CLI** — from a clone of this repository, copy the complete folders (including references/scripts) into the personal skill directory:

```sh
mkdir -p ~/.codex/skills
cp -R skills/ssr-boost-migrate skills/ssr-boost-new-app ~/.codex/skills/
```

Or copy them into the target repository:

```sh
mkdir -p /path/to/app/.codex/skills
cp -R skills/ssr-boost-migrate skills/ssr-boost-new-app /path/to/app/.codex/skills/
```

The [current Codex documentation](https://developers.openai.com/codex/skills) specifies `.agents/skills` for discovery. For those versions, copy into `~/.agents/skills` or the application's `.agents/skills` instead, or expose the personal copies above with per-skill symlinks:

```sh
mkdir -p ~/.agents/skills
ln -s ~/.codex/skills/ssr-boost-migrate ~/.agents/skills/ssr-boost-migrate
ln -s ~/.codex/skills/ssr-boost-new-app ~/.agents/skills/ssr-boost-new-app
```

Use one discovered copy of each skill. For repository copies, use the equivalent symlinks from `.agents/skills/<name>` to `../../.codex/skills/<name>`. Invoke `$ssr-boost-migrate` or `$ssr-boost-new-app`; check `/skills` and restart Codex if the skills do not appear. Review existing folders before copying updates.

**Cursor** — copy the skill folders into the app's `skills/` directory, then add a [project rule](https://cursor.com/docs/context/rules) at `.cursor/rules/ssr-boost.mdc`:

```md
---
description: SSR Boost migration and new application workflows
alwaysApply: false
---
For a Vite SPA migration, read @skills/ssr-boost-migrate/SKILL.md.
For a new SSR Boost app, read @skills/ssr-boost-new-app/SKILL.md.
Follow the selected skill's references and verification procedure.
```

**Other agents** — start with [llms.txt](https://lomray-software.github.io/vite-ssr-boost/llms.txt), or use [llms-full.txt](https://lomray-software.github.io/vite-ssr-boost/llms-full.txt) for the documentation and both skill procedures. The [benchmark reference](/reference/benchmarks) points to current measurements without embedding result numbers.

## Package identity

`@lomray/vite-ssr-boost` adds SSR to React Router apps in Data mode, without moving to Framework mode and without rewriting the app. Keep the Vite configuration, route objects and components; use the same application for SSR or SPA output.

For [incremental SSR](/guide/incremental-ssr), managed Express entries and Fetch `createHandler` accept an `ssr` policy with include/exclude patterns and per-request decisions, default crawler SSR, and a restart-only `SSR_BOOST_SSR_ROUTES` rollback override.

Data mode, not Framework mode. The server uses `createStaticHandler` and `StaticRouterProvider`, and the browser uses route objects with `createBrowserRouter`; see React Router's [mode definitions](https://reactrouter.com/start/modes).

The package declares `engines.node: ">=22.12.0"` and peers for Vite `>=5`, React and React DOM `>=18.2.0`, and React Router `>=7.0.1`. The template tooling uses Node 22.23.2. Check the selected React Router and build tool versions for further engine requirements.

## Public entrypoints

- Vite plugin: `@lomray/vite-ssr-boost/plugin`.
- Cloudflare Workers: `@lomray/vite-ssr-boost/cloudflare` (`createWorkerHandler`, `getHtmlFromAssets`, `RouteAssets`, `TRouteAssetsManifest`); see [Cloudflare Workers](/guide/cloudflare).
- Browser entry: `@lomray/vite-ssr-boost/browser/entry`.
- Managed CLI server entry: `@lomray/vite-ssr-boost/adapters/express/entry`.
- Fetch core: default export `createHandler` from `@lomray/vite-ssr-boost/core/handler`.
- Transport adapters: `@lomray/vite-ssr-boost/adapters/node`, `adapters/express`, `adapters/fastify`, `adapters/hono` and `adapters/edge`, all under the package prefix.
- Renderers: `@lomray/vite-ssr-boost/node/render-to-stream` and `@lomray/vite-ssr-boost/edge/render-to-stream`.
- SSR route testing: `@lomray/vite-ssr-boost/testing`; optional browser assertions: `@lomray/vite-ssr-boost/testing/playwright`. See [Testing](/guide/testing).
- Node production helpers: `@lomray/vite-ssr-boost/node/production`.
- CLI binary: `ssr-boost`.

## Default workflow and transport ownership

Prefer the managed CLI for Vite development, HMR, asset manifests and production static files. It uses Express, and managed request/render hooks retain the live Express `req` and `res` objects. `node/entry` was removed in 8.0.0; use `adapters/express/entry` for v8 and follow [Upgrade from 7 to 8](/guide/upgrade-v8).

A Fetch transport owns its development server, bundling, static assets and route-asset injection. It can initialize `ServerConfig` from `@lomray/vite-ssr-boost/services/server-config` and inject manifest assets with `SsrManifest` from `@lomray/vite-ssr-boost/services/ssr-manifest`; see [Runtime adapters](/guide/runtime-adapters). The [custom-server example](https://github.com/Lomray-Software/vite-template/tree/example/custom-server) demonstrates this integration with Fastify in production and the managed CLI in development.

## Data loading contract

Loader and action promises stream by default in Data mode. Return `{ fast, slow: fetchSlow() }` and consume `slow` inside Suspense with `<Await>` or React 19 `use()`. The browser reconstructs native promises before creating the router; client navigation loaders keep their native promises. See [Stream loader data](/guide/data-streaming) for the supported value matrix, errors and opt-in `hydration: 'early'`. Custom `getState` snapshots still use JSON.

## Application guidance

For an existing Vite + React Router app, run `ssr-boost init --dry-run` first and review every diff before `--apply`. After changing entries, routes, plugins, scripts, or dependencies, run `ssr-boost doctor --json`; resolve errors and inspect version warnings before building. See the [CLI reference](/api/cli) for `--root`, overrides and support bundles.

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

The docs build generates [llms.txt](https://lomray-software.github.io/vite-ssr-boost/llms.txt) and [llms-full.txt](https://lomray-software.github.io/vite-ssr-boost/llms-full.txt) from the Markdown sources. The short file includes the package identity, the resolved release version when available, the public entrypoints and data-loading contract from this page, and an absolute URL for every documentation page. The full file concatenates those pages and both `skills/*/SKILL.md` procedures with their source URLs; relative skill links become absolute repository links.

Run `npm run docs:build` to regenerate both files in `docs/.vitepress/dist`. The version comes from `git describe --tags --match 'v*' --abbrev=0`, with the leading `v` removed. If tags are unavailable, the build falls back to `npm view @lomray/vite-ssr-boost version`; if that also fails, it omits the version line. The build reports which source it used. The docs workflow fetches full Git history and tags so CI can use the tag path. The source manifest's placeholder version is never used; semantic-release assigns the published package version in `lib/package.json` separately.

Generation checks that every indexed URL has a built HTML page and reports the page/link counts. GitHub Pages deploys these files with the rest of the docs; generated copies are not checked in.

## Keeping the Context7 index fresh

[`context7.json`](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/context7.json) selects the `prod` branch and `docs/`. Context7 also includes root Markdown automatically; the filename exclusions leave `README.md` as the root source. Tests, scripts, package output and non-documentation examples are excluded, while `docs/examples/` stays indexed. The rules identify the v8 entrypoints and the removed `node/entry` path. The `v7.1.0` tag is configured as a separate previous version for v7 users. See the [Context7 configuration guide](https://context7.com/docs/library-owners).

Maintainers set the optional repository Actions secret `CONTEXT7_API_KEY`. The [refresh workflow](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/.github/workflows/context7-refresh.yml) calls the [documented refresh API](https://context7.com/docs/integrations/github-actions) on published releases or manual dispatch. The `prod` release job also calls it as a reusable workflow: [events created with `GITHUB_TOKEN` do not start another workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). This also refreshes docs-only changes after a successful `prod` release job.

The API step uses a job environment variable in its condition, following [GitHub's optional-secret pattern](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), so a missing key skips the request. The request refreshes the library's configured source; `context7.json` selects `prod`, so publishing a prerelease does not switch the main index to `staging`. After promoting documentation to `prod`, maintainers can dispatch the workflow to retry a failed refresh or refresh without a release. Check the workflow result and the [Context7 listing](https://context7.com/lomray-software/vite-ssr-boost) after indexing completes; a successful API request queues refresh work and does not prove parsing has finished.
