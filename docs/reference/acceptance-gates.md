# Acceptance gates

Run these before a release. The same checks run in PR and release CI.

| Command | What it checks |
| --- | --- |
| `npm test` | Shared React SSR tests across Node, Express, Fastify, Hono and edge; real React cancellation before/after shell; HTTP/2, redirects, cookies, HEAD/statuses, bounded buffering and compressed shell delivery |
| `npm run lint:check` / `npm run ts:check` | Lint and public/internal TypeScript contracts |
| `npm run build` | Published JavaScript and declaration output |
| `npm run test:size` | Browser public-entry and combined gzip budgets; rejects server dependencies in browser bundles (requires `lib/`) |
| `npm run test:edge:packed` | Built edge output running in Miniflare/workerd |
| `npm run test:bun` | Built Fetch SSR served by Bun, including cookies, HEAD, redirects and POST (requires Bun) |
| `npm run test:core:no-optional` | Packed installation with `--omit=optional`; core and edge run without Express or compression |
| `npm run test:template` | Template SSR in dev/production, cold styles, SSR module reload, streamed and crawler HTML, gzip, static JS/CSS, redirects, HEAD, 404, subpath deployment, standalone SPA, client gzip budget and baseline TTFB comparison |
| `npm run docs:build` | Documentation build and links |

CI pins `vite-template` to `922db6703a1f5baabec9288d9fa35ff787f6454f`. Locally, install its dependencies
in `../vite-template`, or pass its path to `node scripts/test-template.mjs`. The script works on a
copy; it changes only that copy's configuration for the subpath test.

Before shipping, also check the template in a browser: hydration and console errors, client navigation,
Suspense, crawler mode, HMR and SPA deep links. HTTP acceptance checks do not replace browser checks.
Use `SSR_BOOST_KEEP_TEMPLATE=1 npm run test:template` to retain the test copy for inspection.

PR and release CI run the full suite on React/React DOM 18.2.0 and 19.2.8. The release waits for
both versions. Template TTFB comparisons are advisory; early-stream checks retry up to three times
to tolerate shared-runner scheduling. Crawler rendering is checked through Suspense completion
markers instead of comparing timings between separate requests.

## Size budgets

PR and release CI run `npm run test:size` immediately after the library build. The script expands
the JavaScript targets in `package.json`'s exports map against `lib/` and deduplicates extensionless
and `.js` aliases. It excludes server/core/edge/Node runtimes, adapters, CLI, plugins, build services,
their server/tooling helper and constant paths, and declaration-only stubs. The precise exclusions
are documented in `scripts/test-browser-size.mjs`; shared browser modules such as `context/server`
and `helpers/get-server-state` remain covered. New browser entries fail until they have a budget.

Each entry is bundled and minified with esbuild as browser ESM. React, React DOM (including
`react-dom/client` and `react/jsx-runtime`) and React Router stay external. All other dependencies,
including the client HOCs' `hoist-non-react-statics`, count toward size. The combined bundle imports
and re-exports every entry's namespace to retain all public APIs while sharing dependencies.
Any import of `node:`, `express`, `chalk`, `commander` or `json5` (including package subpaths) fails
the gate, even when the size is within budget.

All sizes below use gzip level 9 and **KB = 1024 bytes**. Comparisons use unrounded byte counts.

| Browser entry | Measured gzip KB | Budget KB |
| --- | ---: | ---: |
| `browser/entry` | 0.669 | 1.00 |
| `components/navigate` | 0.334 | 0.50 |
| `components/only-client` | 0.324 | 0.50 |
| `components/render-client` | 1.705 | 2.25 |
| `components/response-status` | 0.172 | 0.25 |
| `components/scroll-to-top` | 0.203 | 0.50 |
| `components/with-suspense` | 1.628 | 2.25 |
| `constants/common` | 0.094 | 0.25 |
| `context/server` | 0.175 | 0.25 |
| `helpers/get-server-state` | 0.101 | 0.25 |
| `helpers/import-route` | 1.937 | 2.50 |
| `interfaces/fc-route` | 0.091 | 0.25 |
| Combined | 3.307 (3386 bytes) | 4.307 (4410 bytes) |
| Template client total | 146.563 | 154 |

The template gate sums the gzip size of each `build/client/assets/*.js` file after the candidate's
production SSR build, including lazy chunks and framework/application dependencies. It excludes
CSS, images, source maps and server output. This is the full pinned acceptance template, so its total
is larger than the minimal example's bundle. Both pinned and current dependency acceptance runs
use the same 154 KB limit.

The browser table is printed and appended to `GITHUB_STEP_SUMMARY` when set. Template acceptance
also prints and appends its client size/budget, production server readiness (process start through
the first successful HTTP response, including readiness polling), baseline/candidate median TTFB,
and development/production/subpath chunk counts. Decoded gzip chunks count HTML payload rather
than gzip headers. Available measurements are reported even if a later acceptance check fails;
unreached timings are marked `not measured`. Readiness and TTFB remain advisory.

For an intentional increase:

1. Run `npm run build`, `npm run test:size` and template acceptance with the pinned template and
   current dependencies. Review the added code/dependencies and record the measured before/after
   sizes and the reason in the PR.
2. Update the table at the top of `scripts/test-browser-size.mjs`: each entry's budget is
   `Math.ceil(measuredGzipKB * 1.25 * 4) / 4` (25% headroom, rounded up to 0.25 KB). The combined
   budget is the measured combined gzip size plus exactly 1 KB; retain byte precision.
3. Set `TEMPLATE_CLIENT_GZIP_BUDGET_KB` near the top of `scripts/test-template.mjs` to
   `Math.ceil(measuredGzipKB * 1.05)` using the pinned template (5% headroom, rounded up to a whole
   KB). Confirm the current-dependency run also fits; investigate any difference before raising it.
4. Update this table, rerun the gates, and temporarily lower a budget to prove that CI would fail.
   Restore the reviewed budget before committing. Never update limits automatically on failure.
