---
name: ssr-boost-new-app
description: Create and roll out a new Vite React Router Data mode application with the published create-ssr-app templates, including streamed data, request state, tests, CI, size checks, and target-specific deployment.
---

# Create an SSR Boost application

Work in the user's chosen parent directory and follow its repository instructions. Use the published scaffolder and inspect the resulting files; template branches evolve independently of this skill. The reference APIs target vite-ssr-boost 8.x. Links to upstream docs remain usable when this folder is installed alone.

The testing kit, incremental SSR policy and Worker helper require a release containing those APIs; the stable 8.3.0 template dependency predates them. For a prerelease evaluation, the published `8.4.0-beta.4` was used for these workflows. Check installed exports and the project's release policy before adopting a prerelease; do not silently use one for a stable-only production rollout.

## 1. Choose and scaffold

Check Node and the current template catalog:

```sh
node --version
npm view @lomray/create-ssr-app version engines
npm create @lomray/ssr-app@latest -- --help
```

SSR Boost requires Node >=22.12.0; satisfy the template dependencies' engines too (the template tooling uses Node 22.23.2). The published [create-ssr-app catalog](https://github.com/Lomray-Software/create-ssr-app#templates) has these five choices:

| Template | Choose it for | Command |
| --- | --- | --- |
| `minimal` | Small app with metadata, loaders, lazy CSS, redirects, 404 and client-only routes | `npm create @lomray/ssr-app -- --template minimal` |
| `full` | MobX, consistent Suspense and the full reference application | `npm create @lomray/ssr-app -- --template full` |
| `custom-server` | Managed development and a Fastify production server owned by the app | `npm create @lomray/ssr-app -- --template custom-server` |
| `tanstack-query` | Per-request QueryClient, dehydration and streamed pending queries | `npm create @lomray/ssr-app -- --template tanstack-query` |
| `localization` | Per-request i18next, cookie/header language selection and restoration | `npm create @lomray/ssr-app -- --template localization` |

Use `minimal` unless the requested app benefits from another template. Those commands prompt for a directory on a TTY; non-TTY defaults to `my-ssr-app`. Put npm flags after `--`. To choose a directory explicitly, suppress prompts and leave Git initialization to the user/repository workflow:

```sh
npm create @lomray/ssr-app@latest my-app -- --template minimal --no-git --yes
cd my-app
```

Use `--no-install` when you need to inspect dependencies before installing. The normal command installs them already. `--no-git` also removes Husky and `scripts.prepare`; the generated CI workflow is still included. Do not use `--force` to scaffold over an existing application.

## 2. Inspect the structure and establish checks

Read `package.json`, the lockfile, `.nvmrc`, Vite config, `.env` examples, `src/app.tsx`, `src/client.ts`, `src/server.ts`, `src/routes/index.ts`, `src/pages/`, `scripts/` and `.github/workflows/ci.yml`. These templates use Vite `root: 'src'`, public assets outside it, and `build/client` plus `build/server` output. Keep the actual aliases and filenames. Review [entries](references/entries.md) for the wrapper prop contract and exact managed/Fetch API shapes.

```sh
npx ssr-boost doctor --json
npm run develop
```

Review all doctor errors and version warnings; repeat until errors are fixed. Current templates also use the tested React 19 / Router 8 / Vite 8 combination. For Vite 6/7, React 18/19 and Router 7 compatibility choices, use the [tested matrix](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/README.md#compatibility), not just peer ranges. Keep matching React/React DOM versions and one physical copy of each.

Inspect the homepage, direct nested routes and a lazy route during development, then stop the owned server. Keep the generated `size:check` budget as the starting baseline and the `smoke` script with its route expectations; update expectations when replacing sample pages. There is no package CLI `smoke` subcommand.

## 3. Implement the requested application

- Add static Data mode route objects, stable IDs, layouts, error boundaries and literal lazy imports using [routes, loaders and actions](references/routes.md). There is no automatic file-system router, RSC or Server Actions layer. Data mode loaders/actions also run in the browser on navigation; use APIs for secrets, database calls and Worker bindings.
- Return an object with a slow promise and consume it in Suspense/`Await`; use React 19 `use()` only inside a boundary. Forward `request.signal` to I/O. Test success, rejection, redirect and 404 paths. See [streaming](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/data-streaming.md).
- Preserve `@lomray/react-head-manager`: create a Manager per request, provide it through `App`, inject tags at shell readiness and transfer its JSON state to client `init`. Add route titles/descriptions with `<Meta>`. [Entry shapes](references/entries.md) show every import and hook.
- For localization, use the `localization` template's per-request i18next instance. Choose language from the request cookie, then Accept-Language, then an app default; transfer chosen language/resources and initialize the client before hydration. Do not reuse a mutable server i18next instance across requests or choose a different browser language for the initial render. See the [localization example](https://github.com/Lomray-Software/vite-template/tree/example/localization).
- Keep public config in `import.meta.env.VITE_*`; these values are embedded into browser code. Keep secrets in server runtime variables or platform secrets, never in `VITE_*`, route data, `getState`, HTML or tracked env files. Follow the configured Vite `envDir`, add a safe `.env.example`, and restart development after env changes. Worker bindings stay in server-only modules. See [environment guidance](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/migrate-existing-spa.md#environment-variables).
- Restore state only inside the browser entry's async `init`. Default footer hydration is suitable unless early interaction is requested. Early mode requires `hydration: 'early'`, an async client script, and custom state ready at `onShellReady`. Keep browser globals in effects or client-only routes.

## 4. Tests, size and CI

Use [verification recipes](references/verification.md) to add Vitest tests through `@lomray/vite-ssr-boost/testing` and Playwright tests through the separate `testing/playwright` entry. Test real application routes and providers, streamed settlements, bot buffering, redirect/status behavior, hydration and a counter click. Browser assertions must observe the page before navigation. The testing kit does not execute the browser entry in Node.

Retain the generated `.github/workflows/ci.yml`: it installs with `npm ci --ignore-scripts` and runs the available lint, types, styles, warning-failing build, size and smoke scripts. It has no deployment secrets/jobs. Extend it with `npm run test:ssr`, a restored SSR build after smoke, `npx playwright install --with-deps chromium` and `npm run test:browser`; defining new scripts alone does not add them to an already generated workflow.

Run this skill's [verification script](scripts/verify.sh) by its installed path:

```sh
bash /path/to/ssr-boost-new-app/scripts/verify.sh --help
bash /path/to/ssr-boost-new-app/scripts/verify.sh --dry-run .
bash /path/to/ssr-boost-new-app/scripts/verify.sh .
npm run test:ssr
npm run test:browser
```

The verifier runs doctor, build, an enforced app size budget and `npm run smoke`, then restores SSR output because template smoke also builds SPA. Do not raise a failing size budget automatically: inspect emitted chunks and approve intentional app growth with a recorded baseline. Use [diagnostics](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/reference/diagnostics.md) to fix `SSR_BOOST_*` warnings, especially custom JSON state versus rich router data and malformed/duplicated hydration output.

## 5. Prepare deployment and acceptance

Read [deployment by target](references/deployment.md) and prepare the selected Node/Docker, Vercel, Amplify or Cloudflare build and local preview. For a custom transport, read the exact `createHandler` options in [entries](references/entries.md); the transport owns static files and route assets. Check private cache handling, secrets, redirects, 404s, lazy CSS and streaming through the selected adapter. Publish only within the user's deployment authorization.

Before declaring done, run and record:

- [ ] Generated lint, type and style scripts pass, along with the app's own tests.
- [ ] Doctor has no errors and version/informational findings have been reviewed.
- [ ] Build fails on warnings; the app's gzip size check passes against its reviewed budget.
- [ ] HTTP smoke covers SSR and SPA, a streamed route, buffered crawlers, redirects, 404 and HEAD.
- [ ] Testing-kit tests cover real routes and providers, deferred data, errors and statuses.
- [ ] Playwright verifies hydration without mismatch/duplicate output, deferred content, a working counter, navigation and lazy CSS. If early hydration is selected, the counter works while data is pending.
- [ ] Metadata and locale agree between server HTML and the first browser render; no secrets appear in browser output.
- [ ] CI contains the checks above, SSR output is restored after smoke, and the target build/preview works.

Report unrun checks as outstanding with their commands and reasons; do not treat HTTP-only tests as browser hydration evidence.
