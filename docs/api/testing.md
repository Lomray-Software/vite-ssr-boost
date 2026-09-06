# Testing API

```ts
import {
  createTestHandler, TestResponse, createDeferred, crawlerRequest, browserRequest,
} from '@lomray/vite-ssr-boost/testing';
```

See [Test SSR routes](/guide/testing) for complete Vitest and Playwright examples.

## createTestHandler(options)

Returns `{ fetch(input, init?): Promise<TestResponse> }`. It renders in process through `createHandler` and `createStaticHandler`, without starting an HTTP server or following redirects. Relative paths resolve against `http://localhost`; absolute URLs and Fetch `Request` objects are accepted. The wrapper consumes the response stream immediately.

| Option | Description |
| --- | --- |
| `routes` | Required application route objects, including loaders, actions and lazy routes. |
| `App` | Optional React component receiving `children` and `server: context.appProps`. Without it, routes render directly. |
| `shell` | `{ indexFile, outlet? }` uses Node's cached `loadHtmlShell`; `{ header, footer }` works in any Fetch runtime. Omit for a minimal full HTML document and inert module-script placeholder. |
| `routerOptions` | Options forwarded to `createStaticHandler`, including `basename`. |
| `renderToStream` | Override the renderer with the core `TRenderToStream` contract. Defaults to Node pipeable streams or Web streams under edge export conditions. |
| `signal` | Default request cancellation signal, combined with the input Request and per-fetch signal. |
| `timeout` | Optional finite non-negative whole-request deadline in milliseconds. Includes routing, preparation and body reading. |
| Handler options | `diagnostics`, `hydration`, `abortDelay`, `onRequest`, `onRouterReady`, `onShellReady`, `onShellError`, `onError`, `onResponse`, `prepare`, `getState`, `nonce`, `bootstrapScriptContent`, `routerRequestContext` and `onContext` pass through to the Fetch core. |

`onContext({ context })` observes initialized request metadata before routing, including a bypass `onRequest` response (whose shell is empty). It can read `context.timeline?.events`. Each fetch has independent metadata and timeline; the route handler and cached HTML shell are shared by the kit instance.

`fetch(input, init?)` accepts `RequestInit` plus `isStream?: boolean` and `timeout?: number`. A supplied `isStream` overrides the result of `onRouterReady` for that request; the hook still runs. It never infers streaming from the user agent. Per-fetch timeout replaces the default timeout. Signals are combined, so either can cancel the request. Before headers, cancellation rejects fetch; after headers, body accessors reject with the signal reason. The `abortDelay` render deadline is separate and can finish a connected document with deferred rejection frames.

## TestResponse

You can also wrap an existing Fetch response with `new TestResponse(response)`. The `response` property exposes its original metadata; its body belongs to the wrapper's reader. All asynchronous accessors are repeatable.

| Member | Result |
| --- | --- |
| `status` | Numeric HTTP status. |
| `headers` | Fetch `Headers`. |
| `text()` / `html()` | `Promise<string>` containing the full raw document. |
| `chunks()` | `Promise<Array<{ text: string; at: number }>>`; UTF-8 is decoded as chunks arrive, and `at` is milliseconds since fetch began. Empty decoder fragments are omitted. |
| `routerState()` | `Promise<IRouterState \| undefined>` with `loaderData`, `actionData`, `errors`. Deferred fields become settled native values; rejected fields reject the accessor. Also reads legacy JSON hydration state. Missing or duplicate stream settlements throw; scripts are never executed. |
| `pendingBoundaries()` | `Promise<number>` counting raw `<!--$?-->` markers in final HTML. It does not execute React replacement scripts. |
| `streamFrames()` | `Promise<TStreamFrame[]>` in document order. Tuples are `['init', payload, isEarly]`, `['resolve' \| 'reject', id, payload]` or `['shell']`; payloads retain their encoded strings. |
| `timeline()` | `Promise<ITimelineEvent[]>` after reading completes, including after an abort. Empty when recording is disabled or an independently wrapped Response has no supplied timeline. |
| `cookies()` | `Array<{ name: string; value: string; attributes: Record<string, string \| true> }>`; each Set-Cookie is separate. Attribute names are lowercase, flags are `true`, and values (including Expires and encoded cookie values) remain strings. |

`new TestResponse(response, { started?, timeline?, signal?, onComplete? })` also accepts a `performance.now()` request start, a core `RequestTimeline`, a cancellation signal, and a reader completion callback. These options are normally supplied by the kit.

## createDeferred&lt;T&gt;()

Returns `{ promise: Promise<T>, resolve(value: T | PromiseLike<T>): void, reject(reason?: unknown): void }`. Use it for loader/action fields that must settle after the shell. An attached rejection observer prevents unhandled-rejection noise while the router is still preparing; consumers still receive the original rejected promise.

## crawlerRequest(path) and browserRequest(path)

Return Fetch `Request` objects using the kit's default origin for relative paths. The former supplies a Googlebot user agent; the latter a browser user agent. They do not change render options.

## Playwright entry

```ts
import {
  collectStreamTimeline, expectHydrated, expectStreamed,
} from '@lomray/vite-ssr-boost/testing/playwright';
```

The optional peer `@playwright/test >=1.40.0` is required when running these assertions. It is loaded only by this entry's assertion functions.

| Function | Contract |
| --- | --- |
| `collectStreamTimeline(page)` | Call and await before navigation. Returns `Promise<{ read(): Promise<IBrowserTimelineEvent[]> }>` and installs one observer for subsequent documents. |
| `expectHydrated(page, { root = '#root', timeout = 5000 } = {})` | Waits for the SSR Boost router event, document load, settled Suspense boundaries and browser rendering. Asserts state consumption, no observed React hydration errors, and no increased multiplicity of server text. `root` is a CSS selector for the root element. |
| `expectStreamed(page, selector)` | Waits for one matching visible element and asserts its first observed visibility is later than the shell. Uses Playwright's configured assertion timeout. |

Use the SSR Boost browser entry so router creation is observable. Call collection before `page.goto()`; installing it after hydration cannot reconstruct the original DOM or early console errors. The observer leaves stream delivery intact when the browser receiver replaces the queue's `push` method. Browser timeline offsets use navigation's `performance.now()` clock, not the server request clock.

## Timeline types

`ISsrRequestContext.timeline` is an optional request-local `RequestTimeline` with an `events` array. `ITimelineEvent` has `stage`, `at`, optional `id`, optional `placement: 'early' | 'footer'`, and optional `reason`. See the [stage table](/guide/testing#request-timeline) for semantics and the [diagnostics reference](/reference/diagnostics#ssr_boost_timeline) for environment configuration.
