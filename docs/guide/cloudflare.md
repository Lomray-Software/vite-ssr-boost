# Cloudflare Workers

Use `@lomray/vite-ssr-boost/cloudflare` to serve a built React Router Data mode application in
Workers. It provides a Fetch handler, route asset injection, streaming HTML and access to bindings.
Keep your Express server entry for `ssr-boost dev`.

## Build a Worker entry

Install Wrangler in your application:

```bash
npm install --save-dev wrangler
```

Add an extra SSR entry to your existing Vite config. This example uses `src` as the Vite root:

```ts
import { defineConfig } from 'vite';
import SsrBoost from '@lomray/vite-ssr-boost/plugin';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: { outDir: '../build' },
  plugins: [
    SsrBoost({
      clientFile: 'client.tsx',
      serverFile: 'server.tsx', // Existing Express entry for development.
      entrypoint: [{ name: 'worker', type: 'ssr', serverFile: 'worker.ts' }],
    }),
    // Keep your existing React and other Vite plugins here.
  ],
});
```

Create `src/worker.ts` alongside your shared `App` and routes:

```ts
import {
  createWorkerHandler,
  getHtmlFromAssets,
} from '@lomray/vite-ssr-boost/cloudflare';
import manifest from '../build/client/assets-manifest.json';
import App from './App';
import routes from './routes';

export default {
  fetch: createWorkerHandler({
    routes,
    App,
    manifest,
    getHtml: async (_request, env) => (await getHtmlFromAssets(env, '/index.html'))(),
  }),
};
```

The exact JSON import is **`build/client/assets-manifest.json`**, relative to the Worker source.
It is the route-ID-to-assets manifest, not Vite's `.vite/manifest.json`. The CLI writes it alongside
`build/server/assets-manifest.json` after building the client and regular server. The extra Worker
entry is built afterward, so its JSON import exists on a clean build. Do not import the Worker
entry from your client or regular server entry.

Run all build entries:

```bash
npx ssr-boost build --focus-only all
```

The default `ssr-boost build` builds only the app. `--focus-only all` also builds the configured
Worker, emitting `build/worker/worker.js`. No separate Vite invocation or new server-entry flag is
needed. Rebuild all entries after changing routes or assets. The managed watch preview does not
regenerate this production manifest for a Worker.

`App` receives `{ server: appProps, children }`, matching the managed server's wrapper convention.
The handler also accepts `routerOptions`, `modulePreload`, `outlet`, and the Fetch core's lifecycle,
state, nonce, timeout, hydration and router context options. `getHtml(request, env, ctx)` may load a
custom shell. Alternatively, pass `indexHtml` containing the complete built HTML string with exactly
one `<!--ssr-outlet-->` (or your custom `outlet`); do not pass a filename as `indexHtml`.

## Wrangler configuration

Create `wrangler.jsonc` at the project root:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "my-ssr-app",
  "main": "build/worker/worker.js",
  "compatibility_date": "2026-07-30",
  "assets": {
    "directory": "build/client",
    "binding": "ASSETS",
    "run_worker_first": true,
    "html_handling": "none",
    "not_found_handling": "none"
  }
}
```

`run_worker_first` lets the handler render `/` and apply cache headers to static responses.
`html_handling: "none"` lets the shell helper fetch `/index.html` without a redirect. Keep
`not_found_handling: "none"` so a static miss reaches SSR and can return a real 404.
See [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) and
[Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

GET and HEAD requests try the binding for static files, including public files such as
`robots.txt` and extensionless files. `/` always renders; `/index.html` is also routed through SSR.
A binding 404 falls through to React Router. Other binding responses retain their status and
headers. Actions and other methods go directly to SSR. Static hits bypass SSR request hooks;
wrap the returned fetch function if your application needs authentication for static files too.

Successful files matching Vite's default `/assets/name-HASH.ext` convention (at least eight hash
characters) receive `Cache-Control: public, max-age=31536000, immutable`, including conditional
304 responses. Unhashed public files retain the binding's cache policy. Keep Vite's hashed naming
convention; configure your own cache policy if you customize asset names.

To rename the binding, use `assets: 'STATIC'` in `createWorkerHandler`, `binding: 'STATIC'` in
Wrangler, and `getHtmlFromAssets(env, '/index.html', 'STATIC')`. `assets: false` disables static
routing when another layer serves the files; you still need a shell provider.

`getHtmlFromAssets` returns `Promise<() => { header: string; footer: string }>`. It fetches once per
binding, path and outlet, coalesces concurrent loads, and supplies a fresh object for every request.
Failed loads are retried on the next call. Call it during a request, when Workers permits binding I/O.
Its fourth argument changes the outlet. Build a new Worker deployment when the HTML changes.

## Preview and deploy

```bash
# Build client, regular server, route manifest, then Worker.
npx ssr-boost build --focus-only all

# Preview the built app with local Workers bindings in workerd.
npx wrangler dev --local

# Optional: inspect the deployable bundle without publishing.
npx wrangler deploy --dry-run

# Publish the Worker and its static assets together.
npx wrangler deploy
```

Wrangler bundles the emitted Worker and dependencies. The minimal template runs without
`nodejs_compat`. Do not import `node/production`, the Express adapter, or filesystem helpers into
the Worker. The `cloudflare` entry and its library dependency graph contain no Node builtin imports.

## Bindings in hooks and loaders

Generate Worker globals with `wrangler types`, or use `@cloudflare/workers-types` in a Worker-specific
TypeScript config. Avoid mixing DOM and Workers global Fetch types in that config.

```ts
interface Env {
  ASSETS: Fetcher;
  MESSAGES: KVNamespace;
}

const fetch = createWorkerHandler<Env>({
  App, routes, manifest,
  getHtml: async (_request, env) => (await getHtmlFromAssets(env))(),
  onRequest: ({ request, executionContext }) => {
    const { env, ctx } = executionContext.platform;
    executionContext.waitUntil(env.MESSAGES.put('last-path', new URL(request.url).pathname));
    // ctx is the original Worker execution context.
    return { headers: { 'X-Runtime': 'workerd' } };
  },
});

export default { fetch } satisfies ExportedHandler<Env>;
```

Add your KV namespace to Wrangler with `kv_namespaces: [{ binding: 'MESSAGES', id: 'YOUR_KV_ID' }]`.
The local preview uses local KV data; seed it with
`npx wrangler kv key put --binding MESSAGES --local greeting 'Hello from KV'`.

All render hooks receive `context.executionContext`. `onRequest` and `prepare` also receive
`executionContext` directly. The default loader context is the SSR request context:

```ts
import type { LoaderFunctionArgs } from 'react-router';
import type { ISsrRequestContext } from '@lomray/vite-ssr-boost/core/render';
import type { IWorkerPlatform } from '@lomray/vite-ssr-boost/cloudflare';

export async function loader({ context }: LoaderFunctionArgs) {
  const requestContext = context as unknown as ISsrRequestContext;
  const { env } = requestContext.executionContext!.platform as IWorkerPlatform<Env>;
  return { message: await env.MESSAGES.get('greeting') };
}
```

An explicit `routerRequestContext` replaces the default loader context. Browser navigation runs
Data mode loaders in the browser: use an HTTP endpoint for binding-backed data on client navigation.
Do not serialize bindings or the execution context with `getState`.

## Streaming and runtime limits

Streamed HTML defaults to `Content-Encoding: identity` and appends `Cache-Control: no-transform`
to preserve early chunks. In local workerd, automatic gzip buffered a small pending shell until the
loader resolved; identity delivered the shell immediately. Static assets retain normal platform
compression. You can override these defaults in `onShellReady` if you prefer platform compression;
verify chunk delivery with your application and deployment. See
[Cloudflare compression](https://developers.cloudflare.com/speed/optimization/content/compression/).

The default streams HTML and deferred loader frames. Bot user agents, including Googlebot, wait
for all content; `onRouterReady` can override `isStream`. `hydration: 'early'` enables interactive
pending shells with an async browser entry. See [Stream loader data](/guide/data-streaming).

Workers has no Early Hints transport for this handler. It never installs `onEarlyHints`; route
styles and preload links are still injected into the document.

Rendering consumes CPU time; awaiting I/O and elapsed request time are separate constraints.
Choose `abortDelay` for your rendering deadline, give loaders their own I/O deadlines, and check
your plan's [CPU, memory and duration limits](https://developers.cloudflare.com/workers/platform/limits/).
`abortDelay` begins after loader preparation and does not extend Cloudflare's limits.
Use bound `waitUntil` only for background work; its lifetime is limited too.
See [Worker execution context](https://developers.cloudflare.com/workers/runtime-apis/context/).

Workers cannot read your local build filesystem. Bundle the JSON manifest and fetch static files
through the binding. Add `nodejs_compat` only when an application dependency needs supported Node
APIs, then test that dependency in workerd. It does not turn a Worker into a Node server or give
access to local build paths. See [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).

## Development

Use `ssr-boost dev` for Express + Vite development, lazy route styles and HMR. Use a full build and
`wrangler dev --local` to exercise Worker bindings and streaming before deployment.

The Cloudflare Vite plugin assessment is recorded here after running the reproducible
`node scripts/probe-worker-vite.mjs` probe. It uses `cloudflare({ viteEnvironment: { name: 'ssr' } })`
with `SsrBoost()` and a source Worker with an empty development manifest. The production manifest
is generated by a build and cannot supply current development route styles.

Tested with Vite 8.2.2 and `@cloudflare/vite-plugin` 1.54.4:

| Capability | Observed result |
| --- | --- |
| Worker modules and SSR | Loaded and rendered after restarting with inline `indexHtml` and `assets: false`. |
| Assets-backed shell | The plugin rejected the helper's synthetic `/index.html` request with 403. |
| Bindings | KV reads and bound `waitUntil` worked in the inline-shell configuration. |
| Lazy route CSS | Absent from the initial SSR document. With static routing disabled, CSS requests returned 404. |
| Browser entry | Returned 404 in the inline-shell configuration; the source shell had no Vite client injection. |
| SSR reload | Editing the lazy route did not update subsequent SSR responses during the probe. |
| Browser hydration / HMR | Not verified in a browser; the missing entry and styles already prevent recommending this configuration. |

Use the managed development path. The probe's temporary inline-shell variant isolates module
loading and bindings from the asset failures.

Cloudflare's plugin supplies a Workers environment and HMR support, but the SSR BOOST integration
must also provide the development HTML, route styles and hydration behavior.
See [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/) and
[Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/vite-environments/).

## Tests

From the SSR BOOST repository, after `npm run build`:

```bash
npm run test:worker:packed
npm run test:worker:browser
```

The packed test installs the tarball into a temporary minimal template, builds all entries, checks
Worker types, bundles with Wrangler, and boots workerd with Static Assets and KV. It checks routes,
cookies, deferred frames, bot buffering, binding reads, `waitUntil`, cache headers and HEAD requests.
The browser suite checks hydration, navigation, lazy CSS and interactive deferred boundaries.
