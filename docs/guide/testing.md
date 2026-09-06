# Test SSR routes

Use `@lomray/vite-ssr-boost/testing` to run your route objects through the real Fetch SSR core without opening a port. It exercises loaders, redirects, server HTML and the streamed hydration payload. React Router recommends [`createRoutesStub`](https://reactrouter.com/start/data/testing) for isolated components that need router context; this kit covers the server side of full-route integration tests. Use the browser helpers to check actual hydration and interactivity.

## Vitest and deferred data

Install Vitest in your application (`npm install -D vitest`), use the Node test environment, and import your normal route components and providers. This complete 20-line test controls a deferred loader field:

```tsx
// @vitest-environment node
import React, { Suspense } from 'react';
import { Await, useLoaderData } from 'react-router';
import { expect, it } from 'vitest';
import { createDeferred, createTestHandler } from '@lomray/vite-ssr-boost/testing';

it('streams users after the shell', async () => {
  const users = createDeferred<string[]>();
  function Page() {
    const data = useLoaderData() as { users: Promise<string[]> };
    return <Suspense fallback={<p>Loading users</p>}>
      <Await resolve={data.users}>{(names) => <p>{names.join(', ')}</p>}</Await>
    </Suspense>;
  }
  const app = createTestHandler({ routes: [{ id: 'users', path: '/', Component: Page, loader: () => ({ users: users.promise }) }] });
  const response = await app.fetch('/');
  users.resolve(['Ada']);
  expect(await response.routerState()).toMatchObject({ loaderData: { users: { users: ['Ada'] } } });
  expect(await response.html()).toContain('Ada');
});
```

In streaming mode, `fetch()` resolves when React's shell is ready. The response starts reading immediately and retains decoded chunks with millisecond offsets. Release the deferred value after `fetch()`; then `html()`, `chunks()`, `routerState()` and the other asynchronous accessors wait for completion. You can call them repeatedly or concurrently. To synchronize on particular shell bytes, use the existing `onResponse` hook and another `createDeferred<void>()`.

`routerState()` replaces deferred placeholders with their settled values, including nested promises, Dates, Maps, Sets, bigints and undefined. A rejected deferred field makes `routerState()` reject with the transported error; inspect `streamFrames()` to assert rejection frames. No response scripts execute in the Node test process. `html()` returns the raw full document, so React's original pending markers can remain alongside their replacement scripts. `pendingBoundaries()` counts those raw `<!--$?-->` markers; expect zero for a successful buffered crawler render.

For a real app, pass `App` and initialize its server props through `onRequest`, just as with your server entry:

```tsx
const app = createTestHandler({
  routes,
  App,
  shell: { indexFile: new URL('../src/index.html', import.meta.url).pathname },
  onRequest: () => ({ appProps: makeServerProps() }),
  hydration: 'early',
});
```

The kit uses `loadHtmlShell` to read and validate the file once. The default document uses `<div id="root"><!--ssr-outlet--></div>` and an inert module-script placeholder. It does not serve or execute your client assets. Reuse application Vite aliases and transforms in your Vitest configuration when your real routes need them.

## Cookies, redirects and crawlers

Requests preserve status and headers and do not follow redirects. `cookies()` returns each Set-Cookie separately, including cookies with the same name but different paths:

```tsx
import { redirect } from 'react-router';
import { createTestHandler, crawlerRequest } from '@lomray/vite-ssr-boost/testing';

const app = createTestHandler({
  routes: [
    { path: '/login', loader: () => redirect('/account', {
      headers: { 'Set-Cookie': 'session=demo; Path=/; HttpOnly' },
    }) },
    { path: '/account', Component: AccountPage, loader: accountLoader },
  ],
  onRouterReady: ({ context: { request } }) => ({
    isStream: !request.headers.get('user-agent')?.includes('Googlebot'),
  }),
});
const login = await app.fetch('/login');
expect(login.status).toBe(302);
expect(login.headers.get('Location')).toBe('/account');
expect(login.cookies()[0]).toEqual({
  name: 'session', value: 'demo', attributes: { path: '/', httponly: true },
});
const crawler = await app.fetch(crawlerRequest('/account'));
expect(await crawler.pendingBoundaries()).toBe(0);
```

Bot detection belongs to your application. `crawlerRequest` only adds a Googlebot user agent, and `browserRequest` adds a browser user agent. The kit passes `onRouterReady` through; `app.fetch(path, { isStream: false })` explicitly overrides its result for one request. For a controlled deferred crawler test, resolve its data while `app.fetch()` is still pending, since buffering waits for every boundary and data promise.

Pass `{ signal }` or `{ timeout: 500 }` to `fetch()` (or set defaults on `createTestHandler`) to bound the whole request, including loaders and reading the body. Cancellation rejects `fetch()` before a response exists, or rejects body accessors after the shell. `timeline()` remains readable after a cancelled body. The core's separate `abortDelay` starts after router preparation and produces rejection frames and closing HTML when the connected render times out. Forward the loader's `request.signal` to its underlying I/O.

## Playwright

Install the optional peer with `npm install -D @playwright/test` and configure Playwright's `webServer` to run your application. The testing entry never imports Playwright; browser helpers live in `@lomray/vite-ssr-boost/testing/playwright`.

This complete spec assumes a `/deferred` route like the one in [Data streaming](/guide/data-streaming), with its resolved element marked `data-resolved`. Install observation **before** navigation so it includes errors and server DOM from before hydration:

```ts
import { test, expect } from '@playwright/test';
import {
  collectStreamTimeline, expectHydrated, expectStreamed,
} from '@lomray/vite-ssr-boost/testing/playwright';

test('hydrates a streamed route', async ({ page }) => {
  const timeline = await collectStreamTimeline(page);
  await page.goto('http://localhost:5173/deferred', { waitUntil: 'commit' });
  await expectStreamed(page, '[data-resolved]');
  await expectHydrated(page, { root: '#root', timeout: 10_000 });
  await expect(page.locator('[data-resolved]')).toHaveCount(1);
  console.info(await timeline.read());
});
```

`expectHydrated` waits for the SSR Boost browser entry's router-ready event, document completion and settled Suspense boundaries. The entry captures router state and removes `window.__staticRouterHydrationData` before hydrating. The helper checks that consumption, console/page hydration errors (including React #418/#423/#425), and whether any server text occurs more often after hydration. Select a stable root if your application intentionally adds repeated text during mount. This is a text-duplication check, not a pixel or complete DOM equality assertion. Add application-specific interaction assertions, such as clicking a counter, to prove event handlers work.

`expectStreamed` requires the selected element to first become visible after the observed shell; an element already in a buffered shell fails. Observation persists across full navigations and starts fresh in each document. `timeline.read()` returns browser offsets from navigation, with `shell`, `router.ready`, frame `init`/`resolve`/`reject` events and `response.end` (the load event). These are browser observations, separate from server timings.

## Request timeline

Enable `diagnostics: true` in a test and inspect `await response.timeline()`. Server hooks can read the same request's `context.timeline?.events`. `SSR_BOOST_TIMELINE=1` enables recording independently of diagnostics and prints one JSON line per completed or cancelled request in development. It remains silent in production. No timeline instance, event array or timeline clock read is created when diagnostics and the environment override are off.

```ts
const app = createTestHandler({ routes, diagnostics: true, hydration: 'early' });
const response = await app.fetch('/deferred');
console.table(await response.timeline());
```

| Stage | Meaning of `at` (milliseconds since request start) |
| --- | --- |
| `router.query` | React Router finished loaders/actions and matching. |
| `prepare` | The preparation hook finished. |
| `shell.ready` | React produced its first shell, even when output is buffered. |
| `state.emitted` | State entered the HTML stream; `placement` is `early` or `footer`. |
| `stream.resolve` / `stream.reject` | A deferred value settled and its frame was queued; `id` identifies the promise within this request. |
| `body.end` | React's body stream ended. Unconsumed loader data can still be pending. |
| `response.end` | The final transformed Fetch body finished or was cancelled. This is not a socket-delivery timestamp. |
| `abort` | Cancellation, deadline or failure; `reason` explains why. |

These are completion/emission offsets, not separate durations. A large `router.query` offset points to blocking loaders. A long gap after `shell.ready` with late promise settlements points to deferred work. In early mode `state.emitted` precedes deferred settlements; footer state follows the React body. Redirects and bodyless responses omit stages they never execute. An abort followed by rejection frames means pending promises were rejected before the connected response closed.

## Edge tests

The `workerd`, `worker`, `edge-light` and `browser` export conditions select the Web-stream renderer; Node selects the pipeable renderer. You can also import `@lomray/vite-ssr-boost/testing/edge` explicitly in a Node Vitest suite to exercise Web streams. Pass `shell: { header, footer }` in an edge runtime, since `indexFile` uses the Node filesystem. Both entries share the same Fetch-only kit and neither requires Express. See the [API reference](/api/testing) for all options.
