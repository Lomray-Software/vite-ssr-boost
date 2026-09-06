# Verification recipes

Run checks from the app root. Use the app's installed CLI and package manager. These are application checks; repository-only commands such as SSR Boost's own `test:browser` do not exist in a generated app until you add them.

## HTTP smoke and size

The generated templates ship `scripts/smoke.mjs`, `scripts/smoke.config.json`, and `scripts/size-budget.mjs`, with `smoke` and `size:check` package scripts. Keep them and adapt route expectations to your application. The smoke script starts/stops its own servers, checks SSR statuses/content, HEAD, multiple decoded HTML chunks, buffered crawlers and SPA responses, and ends with a SPA build. It does not launch a browser or prove event handlers work. Rebuild SSR afterward.

An enforced application budget measures the generated **client** JS, not node_modules size or the SSR Boost package alone. Record the gzip total and chunks before and after changes. The minimal template's size script sets a numeric cap with headroom; review it deliberately when replacing sample pages. Missing output or an exceeded cap must fail. See [acceptance gates](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/reference/acceptance-gates.md).

For a migrated SPA without these scripts, copy the bundled [smoke tool](../assets/smoke.mjs) and [size tool](../assets/size-budget.mjs) into the application's `scripts/` directory. They are user-editable tools; inspect them before running. The smoke tool is adapted from the official minimal template at `66da771d0e3b092e716378ede0952674448d3dbf` to accept `buildDir` in its config.

Set package scripts `smoke` to `node scripts/smoke.mjs` and `size:check` to `node scripts/size-budget.mjs`. Set `start:ssr` to `ssr-boost start --build-dir dist` when preserving stock Vite output. Add the deferred route from the route reference and these route objects to the shared array:

```tsx
{ id: 'redirect', path: '/redirect', loader: () => redirect('/', 302) },
{ id: 'missing', path: '/missing', loader: () => { throw new Response('Not found', { status: 404 }); } },
```

Import `redirect` from `react-router`; preserve existing app routes instead of adding duplicates. For a standalone Vite SPA, the entry reference's metadata wrapper replaces init's generated wrapper and the existing App remains the home **page**. Its server entry includes crawler buffering required by smoke.

```json
// scripts/smoke.config.json (remove this comment in JSON)
{
  "buildDir": "dist",
  "routes": [
    { "path": "/", "status": 200, "contains": ["window.__staticRouterHydrationData"] },
    { "path": "/deferred", "status": 200, "contains": ["Deferred data", "Ada Lovelace"] },
    { "path": "/redirect", "status": 302 },
    { "path": "/missing", "status": 404 }
  ],
  "streamPath": "/deferred",
  "crawlerCookie": "isCrawler=1",
  "crawlerRoutes": [{ "path": "/deferred", "contains": ["<li>Ada Lovelace</li>"] }]
}
```

The size tool takes `scripts/size-budget.json` with `assetsDir` relative to the app root and a positive `maxGzipBytes`. Measure the original SPA before migration with `node scripts/size-budget.mjs --measure dist/assets` after its existing build, and measure SSR output with `--measure dist/client/assets`. Set a reviewed cap from these baselines and required functionality; for an initial accepted baseline, 5% headroom is a starting policy, not an automatic pass.

```json
// scripts/size-budget.json (example shape; replace the cap with your measured decision)
{ "assetsDir": "dist/client/assets", "maxGzipBytes": 120000 }
```


## SSR testing kit

First check the installed package, not only its version range:

```sh
node --input-type=module -e "await import('@lomray/vite-ssr-boost/testing')"
```

Stable 8.3.0 does not ship this export. For a prerelease evaluation in a temporary app, install the explicitly tested release and rerun doctor/build/size/smoke:

```sh
npm install @lomray/vite-ssr-boost@8.4.0-beta.4
```

For a stable-only rollout, use a stable release that contains these APIs before claiming testing-kit or Worker acceptance. Check the [release channels](https://github.com/Lomray-Software/vite-ssr-boost/releases). Keep the exact evaluated version in the lockfile.

```sh
npm install -D vitest @playwright/test
```

Add `test:ssr: "vitest run --config vitest.config.ts"` and `test:browser: "playwright test --config playwright.config.ts"` to package scripts. Keep other tests. In an app with no Vitest config, start with:

```ts
// vitest.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.tsx'] },
  // Reuse the application's resolve.alias if routes import aliases.
});
```

The template's aliases are in `tsconfig.json`; Vitest needs those aliases too. With Vite 8, add `resolve: { tsconfigPaths: true }`. With Vite 6/7, use `vite-tsconfig-paths` (`npm install -D vite-tsconfig-paths`) and add `tsconfigPaths()` to the existing `plugins: [react()]` array with `import tsconfigPaths from 'vite-tsconfig-paths'`, or copy the app's explicit `resolve.alias`. Keep the React transform in this standalone config, especially when the root tsconfig only references tsconfig.app.json; otherwise JSX can fail with `React is not defined`. Do not load SsrBoost's build plugin into isolated Node tests. If the app changes filenames, adjust the two local imports below (the template uses `../src/routes/index` and `../src/app`; the migrated SPA wrapper is `../src/ssr-app`). This tests real routes and providers, not a replacement route fixture.

For React Router 7 in standalone Vitest, if `useLoaderData` reports a missing Data router despite the kit providing one, inline the package and router into the same test module graph. Add this inside `test` (it fixes the ESM/CommonJS context split observed during migration dogfooding):

```ts
server: { deps: { inline: ['@lomray/vite-ssr-boost', 'react-router'] } },
```

The prerelease's published source maps can report missing original source files when inlined; check the actual test result separately from those map warnings.


```tsx
// tests/ssr.test.tsx
import { Manager } from '@lomray/react-head-manager';
import { createTestHandler, crawlerRequest } from '@lomray/vite-ssr-boost/testing';
import { expect, it } from 'vitest';
import App from '../src/app';
import routes from '../src/routes';

const app = createTestHandler({
  routes,
  App,
  diagnostics: true,
  onRequest: () => ({ appProps: { metaManager: new Manager() } }),
  onRouterReady: ({ context: { request } }) => ({
    isStream: !request.headers.get('user-agent')?.includes('Googlebot'),
  }),
});

it('streams the real deferred route and transports its loader data', async () => {
  const response = await app.fetch('/deferred');
  expect(response.status).toBe(200);
  expect(await response.html()).toContain('Ada Lovelace');
  expect(await response.pendingBoundaries()).toBeGreaterThan(0);
  expect(JSON.stringify(await response.routerState())).toContain('Ada Lovelace');
  const timeline = await response.timeline();
  expect(timeline.some((event) => event.stage === 'shell.ready')).toBe(true);
});

it('buffers the same route for a crawler', async () => {
  const response = await app.fetch(crawlerRequest('/deferred'));
  expect(await response.html()).toContain('Ada Lovelace');
  expect(await response.pendingBoundaries()).toBe(0);
});

it('preserves the app redirect and missing-route status', async () => {
  const redirected = await app.fetch('/redirect');
  expect([301, 302]).toContain(redirected.status);
  expect(redirected.headers.get('location')).toBe('/');
  expect((await app.fetch('/missing')).status).toBe(404);
});
```

Adapt `/redirect`'s expected destination/status to the app. Add rejected deferred work, cancellation, actions and locale isolation tests when those paths are used. `routerState()` resolves rich values but never executes response scripts. In a controlled deferred test, resolve `createDeferred()` **after** streaming `app.fetch()` returns; for buffered requests, resolve it while fetch is pending. See the [testing kit](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/docs/guide/testing.md).

## Browser hydration

Mark the `/deferred` route's resolved `<ul>` with `data-resolved`. Keep its `Count: 0` button and deferred timer for this acceptance test, or change the selectors and expected text to match your application. Install Chromium on the machine running these tests:

```sh
npx playwright install chromium
npm run build
```

Copy the bundled [playwright.config.ts template](../assets/playwright.config.ts.txt) to `playwright.config.ts` in the app (drop the `.txt` suffix).

For a custom Fastify launcher use its supported port environment variable instead of CLI flags. If output is `dist`, the start script must include `--build-dir dist`.

Copy the bundled [tests/browser/hydration.spec.ts template](../assets/hydration.spec.ts.txt) to `tests/browser/hydration.spec.ts` in the app (drop the `.txt` suffix).

For `hydration: 'early'`, add a test that waits only for the shell, asserts `[data-resolved]` is absent, clicks the counter and asserts `Count: 1` while the deferred field is still absent; then await the field and hydration. Use a controlled slow API response when timing would otherwise be unreliable. Also exercise client navigation to a lazy route and assert its computed CSS, then reload its URL. Repeat the app's locale/head and rejection expectations in a browser.

A browser executable being unavailable is an unrun acceptance check. `playwright test --list` can validate discovery without launching it, and the testing kit can still exercise Fetch SSR, but neither replaces the hydration test.
