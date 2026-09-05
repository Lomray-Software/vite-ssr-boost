# Acceptance gates

Run these before a release. The same checks run in PR and release CI.

| Command | What it checks |
| --- | --- |
| `npm test` | Shared React SSR tests across Node, Express, Fastify, Hono and edge; real React cancellation before/after shell; HTTP/2, redirects, cookies, HEAD/statuses, bounded buffering and compressed shell delivery |
| `npm run lint:check` / `npm run ts:check` | Lint and public/internal TypeScript contracts |
| `npm run build` | Published JavaScript and declaration output |
| `npm run test:edge:packed` | Built edge output running in Miniflare/workerd |
| `npm run test:bun` | Built Fetch SSR served by Bun, including cookies, HEAD, redirects and POST (requires Bun) |
| `npm run test:core:no-optional` | Packed installation with `--omit=optional`; core and edge run without Express or compression |
| `npm run test:template` | Template SSR in dev/production, cold styles, SSR module reload, streamed and crawler HTML, gzip, static JS/CSS, redirects, HEAD, 404, subpath deployment, standalone SPA and baseline TTFB comparison |
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
