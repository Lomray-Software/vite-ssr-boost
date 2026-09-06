---
name: ssr-boost-migrate
description: Migrate an existing Vite and React Router SPA to vite-ssr-boost SSR in Data mode, preserving route objects and checking streaming, hydration, bundle size, and deployment readiness.
---

# Migrate a Vite SPA

Use this procedure in the application repository. Read its instructions and preserve its package manager, providers, routes and unrelated changes. The API examples target vite-ssr-boost 8.x; read the installed version before changing imports. Documentation links point to the upstream repository so they work when this skill is copied on its own.

The testing kit, incremental SSR policy and Worker helper require a release containing those APIs; the stable 8.3.0 template dependency predates them. For a prerelease evaluation, the published `8.4.0-beta.4` was used for these workflows. Check installed exports and the project's release policy before adopting a prerelease; do not silently use one for a stable-only production rollout.

## 1. Establish the baseline

- Inspect `package.json`, the lockfile, Vite config, HTML module script, browser entry, route definitions and deployment target. Run existing checks and record the current client JavaScript size before editing.
- The migration baseline is Vite **6/7**, matching React/React DOM **18/19**, and **react-router 7 Data mode**. Tested combinations include React 18.2.0 + Router 7.18.3 + Vite 6.4.3 and React 19.2.8 + Router 7.18.3 + Vite 7.3.6. Node must satisfy the installed packages' engines (SSR Boost requires >=22.12.0). See [compatibility](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/README.md#compatibility). Newer templates also use the separately tested React 19 / Router 8 / Vite 8 row; peer ranges alone are not proof of compatibility.
- If the SPA uses JSX `BrowserRouter`/`Routes`, first migrate it to one `createBrowserRouter(routes)` and `RouterProvider`. Preserve nested layouts, error boundaries and provider order. [Route and loader shapes](references/routes.md) include a minimal before entry. Verify the SPA still works before adding SSR. Do not move to React Router Framework mode.
- Record browser-only imports, module-scope state reads, custom router options, multiple roots and non-root Vite `base`. Automatic init deliberately refuses ambiguous startup code; preserve it with the [manual entry shapes](references/entries.md) and [migration guide](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/migrate-existing-spa.md).

## 2. Preview, review, apply

Run from the application root:

```sh
npx @lomray/vite-ssr-boost init --dry-run
```

With no flag, init also defaults to a dry run. Review the complete diff: existing Vite plugins remain, exactly one outlet is inside `#root`, client and server share routes and the same wrapper tree, and scripts/dependencies are correct. Then apply the reviewed plan:

```sh
npx @lomray/vite-ssr-boost init --apply
npm install
npx ssr-boost doctor --json
```

Init does not install packages. It preserves the original browser filename (often `src/main.tsx`), creates `src/server.ts`, and sets `clientFile`/`serverFile` relative to the Vite root. It can extract inline routes into `routes.ssr.tsx`. Do not rename files just to match examples. Review the changed build script: init replaces `tsc -b && vite build`, so retain type checking as a separate `ts:check` script. A second apply should report no changes.

For explicit paths use `--root <project> --entry <browser-file> --routes <exported-route-module>`; the file overrides are relative to the project, not the Vite root. If analysis fails, use the reported file/line and the manual guide; do not repeatedly apply or delete custom code to force acceptance.

## 3. Complete request state and data loading

Read [entries and createHandler options](references/entries.md) before editing either entry. Use `browser/entry` and `adapters/express/entry`; `node/entry` was removed in v8. Keep the managed CLI unless the chosen target requires an application-owned transport.

Move `getServerState` reads and store construction into the browser entry's async `init`, after SSR state is ready. Use `isSSRMode` for the SPA fallback. Create server stores and head managers per request in `onRequest`; return JSON snapshots from `getState`. Keep browser globals in effects or client-only boundaries, and preserve equivalent first-render data on both sides.

Use [streamed loader/action shapes](references/routes.md): return an object with a slow promise, then consume it with Suspense and `<Await>` (or React 19 `use`). Keep Data mode loaders/actions browser-compatible for navigation; server-only I/O belongs behind an API. Forward `request.signal`. Keep footer hydration unless early shell interaction is required; early mode needs an async module script and all custom state at shell readiness. See [streaming](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/data-streaming.md).

## 4. Diagnose until green

Run `npx ssr-boost doctor --json` after dependency, entry, route, config or script changes. Fix every error and rerun until there are none. Inspect compatibility warnings against the tested matrix; an exit code of zero does not mean every check was `ok`. Robots and size checks are informational; doctor does not measure bundle size or execute hydration. It statically checks the managed Express entry even for apps with an additional Worker entry.

| Diagnostic | Fix |
| --- | --- |
| `SSR_BOOST_LOADER_NOT_SERIALIZABLE` | Replace functions, unsupported classes and cycles with explicit route data. Streamed promises and documented rich router values are supported. |
| `SSR_BOOST_STATE_NOT_SERIALIZABLE` | Return a plain JSON snapshot from `getState`; await custom state, convert dates and collections, rebuild stores inside client `init`. |
| `SSR_BOOST_OUTLET_MISSING` | Preserve exactly one `<!--ssr-outlet-->` inside the root; validate Fetch shells with `loadHtmlShell`. |
| `SSR_BOOST_HYDRATION_STATE_MISSING` | Preserve generated state scripts and flush retained footer HTML on the final `onResponse` call. |
| `SSR_BOOST_DUPLICATE_OUTPUT` | Emit each retained chunk once; inject head contents into the existing head. |
| `SSR_BOOST_ONRESPONSE_INVALID_RETURN` | Make the hook synchronous; return string, `undefined` (keep) or `''` (withhold), never a promise. |
| `SSR_BOOST_STREAM_PROMISE_ABORTED` | Bound/cancel loader I/O, handle rejection UI, and review `abortDelay` for legitimately slow work. |
| `SSR_BOOST_DEPRECATED_REQ_RES` | Use `context.request` and `context.response` in render hooks; early Express `onRequest(req, res)` is unchanged. |
| `SSR_BOOST_SSR_POLICY` | Inspect the selected URL policy and pattern spelling when a page unexpectedly mounts as SPA. |
| `SSR_BOOST_CACHE_PRIVATE_LEAK` | Restore private/no-store handling and bypass shared cache reads and writes for personalized pages. |

See [diagnostics](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/reference/diagnostics.md) and [v8 upgrades](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/upgrade-v8.md). Hydration mismatches also require comparing dates, randomness, locale and browser-dependent branches in the initial render; do not suppress them.

## 5. Verify and roll out

Set up [HTTP smoke, size, SSR and browser checks](references/verification.md), then run this skill's [verification script](scripts/verify.sh) from the app root using its installed absolute path:

```sh
bash /path/to/ssr-boost-migrate/scripts/verify.sh --help
bash /path/to/ssr-boost-migrate/scripts/verify.sh --dry-run .
bash /path/to/ssr-boost-migrate/scripts/verify.sh .
npm run test:ssr
npm run test:browser
```

There is no `ssr-boost smoke` subcommand: `npm run smoke` is an application script. The verifier runs doctor, build, the application's enforced size budget and smoke checks, then restores the SSR build because the template smoke ends with SPA output. Compare the new gzip total to the pre-migration baseline; investigate changed chunks before intentionally setting the reviewed budget. Do not copy the library's own budget into an app or automatically raise a failing budget.

For a large app, use [incremental SSR](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/incremental-ssr.md): add `ssr: { mode: 'include', routes: ['/', '/articles/:slug'] }` beside `init` in the managed entry (or beside `getHtml` for Fetch). Widen the allow-list after direct-load, client navigation and hydration checks. Crawlers receive SSR by default, even outside the allow-list; use `bots: 'policy'` only when intended. Restart with `SSR_BOOST_SSR_ROUTES='!/details'` for a route rollback. SPA-selected requests skip server loaders/actions, so keep authentication and HTTP redirects in `onRequest`.

Read [deployment choices](references/deployment.md) for Docker/Node, Vercel, Amplify or Cloudflare Workers. Before declaring done, require green existing lint/types/tests, doctor review, enforced size budget, SSR and SPA smoke, streamed data and buffered bot checks, real browser hydration with a working counter, lazy CSS/navigation, redirects/404s, and a build/preview for the selected target. Record commands, outcomes and any unavailable checks explicitly; an unrun browser check is still outstanding.
