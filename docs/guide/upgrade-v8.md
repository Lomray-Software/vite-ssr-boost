# Upgrade from 7 to 8

Use this guide when upgrading an existing `@lomray/vite-ssr-boost` v7 application. If you are adding SSR to a Vite SPA for the first time, start with [Migrate an existing SPA](/guide/migrate-existing-spa).

## Node requirement

The package requires Node.js `>=22.12.0`, as declared by [`package.json` engines.node](https://github.com/Lomray-Software/vite-ssr-boost/blob/prod/package.json). Check the engine requirements of your chosen React Router and build tools as well. Raising this package requirement in the future is a breaking change under the [support policy](/reference/support).

## Update the package and imports

```bash
npm install @lomray/vite-ssr-boost@^8
```

The following paths were removed in **8.0.0**. For the managed CLI, update the server entry:

```ts
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';

export default entryServer(App, routes, options);
```

Update imports relative to `@lomray/vite-ssr-boost/` (also applies to explicit `.js` imports):

| Removed path | New path |
| --- | --- |
| `node/entry` | `adapters/express/entry` |
| `node/server` | `adapters/express/server` |
| `node/render` | `adapters/express/render` |
| `node/create-fetch-request` | `adapters/express/create-request` |
| `services/prepare-server` | `adapters/express/prepare-server` |

The old `node/write-response` and `helpers/handle-response` internals are removed. The renderer now
handles response composition and redirects through the Fetch core; custom Node transports can send
the resulting `Response` with `node/write-fetch-response`.

- The default shell-error page returns a generic HTTP 500 without exception messages. Use `onError`
  for diagnostics or `onShellError` for a custom page.
- Request/render hook failures reach Express error middleware through `next(error)`, rather than
  falling through to a 404. Register error middleware after the SSR handler.
- Unless explicitly overridden, rendered responses use React Router's status, including 404 for
  unmatched routes. Previously these could be sent as 200.
- Render timeouts and client/intentional cancellation report `onError` codes `timeout` and `cancel`.
  The managed Express server logs these at info level. Unexpected errors retain their original error.
- Parsed JSON and flat URL-encoded bodies work automatically. Nested form values and unsupported
  custom or multipart parser results fail explicitly; use [`getBody`](/guide/runtime-adapters#request-bodies).
- Package exports support extensionless and explicit `.js` imports for the new paths, with matching
  TypeScript declarations. Other module paths are unchanged.

The browser entry remains `@lomray/vite-ssr-boost/browser/entry`. Applications that own their transport can use the default `createHandler` export from `@lomray/vite-ssr-boost/core/handler`; follow [Runtime adapters](/guide/runtime-adapters) for server, asset and bundling responsibilities.

Express and compression are optional dependencies installed by default. If you install with `--omit=optional`, install `express` and `compression` explicitly for the managed CLI.

## Review `onResponse`

The hook receives `{ context, html, isEnd }` and synchronously returns a string, `undefined` or nothing. It transforms decoded HTML chunks; split UTF-8 characters are preserved, but a chunk can still end partway through an HTML tag.

- Regular chunks use `isEnd: false`. Return `undefined` or nothing to keep the original chunk, a string to replace it, or `''` to withhold it while buffering an unfinished token.
- After the complete composed body, including the footer, the hook receives one final call with `html: ''` and `isEnd: true`. Return a string to append buffered content; `undefined` or `''` appends nothing.
- This contract applies to streamed and buffered rendering (`isStream: false`). Hooks that ignore `isEnd` remain supported.

For a request-scoped `@lomray/consistent-suspense` transform:

```ts
onResponse: ({ context: { appProps: { streamSuspense }, isStream }, html, isEnd }) => {
  if (!isStream) return;
  return isEnd ? streamSuspense.end() : streamSuspense.analyze(html);
},
```

See the [server entry API](/api/server-entry#onresponse) for the full signature.

## Review `context.request`

The Express adapter's render-hook context now includes `request`, the Fetch `Request` used by React Router and the core. Use its `url`, `headers` and `signal` for Fetch-based request handling and cancellation. When constructing typed render-hook contexts in application code or fixtures, include this field.

`context.request` is available in render hooks, after the adapter converts the request; it is not an Express request and is not added to the earlier managed `onRequest(req, res)` parameters. Fetch-core hooks use Web-standard requests and responses and do not emulate Express objects.

## Deprecated in 8.x

Managed Express `context.req` and `context.res` remain available in 8.x, with removal planned for
**9.0** after the [support policy](/reference/support) notice periods. Reading either field in
development emits [`SSR_BOOST_DEPRECATED_REQ_RES`](/reference/diagnostics#ssr_boost_deprecated_req_res)
once per process. Production has no accessors or warning overhead.

Use `context.request` for request data, `context.response.headers` and `context.response.status`
for response metadata before shell readiness, and React Router HTTP helpers such as `redirect()`
in loaders/actions. Keep Express-specific middleware or response takeover in Express middleware.
The earlier `onRequest(req, res)` hook still receives the same arguments, but it is deprecated and
logs the warning described below.

Express-only entry hooks (`onRequest(req, res)`, `shouldSkip`, `onServerCreated`,
`onServerStarted` and `middlewares.expressStatic`) keep working in 8.x and log
[`SSR_BOOST_DEPRECATED_EXPRESS_HOOK`](/reference/diagnostics#ssr_boost_deprecated_express_hook)
once per hook, in development and production, unless `SSR_BOOST_DIAGNOSTICS=0`. Their
replacements are `defineEntry` and the [Node server kit](/guide/runtime-adapters); removal is
planned for **9.0**.

## Process signals and shutdown

The CLI now drains the managed server on `SIGTERM` and `SIGINT`: readiness turns off, new
connections are refused, open requests finish within `drainTimeoutMs` per phase, and a second signal
forces the close. With the Express server, an application that subscribes to `SIGTERM` or `SIGINT`
itself keeps that handling: once the server is listening, the CLI leaves signals alone when any
listener for them is present, whether a preloaded module (`node --require`), a library in your entry
or `onServerStarted` added it. Remove your own listener to use the managed drain. A listener added
in the synchronous part of `onServerStarted` is always seen by that check. One added later (after an
`await` or a timer) is seen only when it is registered before the check runs; otherwise both your
handler and the managed drain run on the same signal, so subscribe synchronously.

Configuration load errors in `ssr-boost dev` now stop the command with the original error instead of
falling back to the Express server. Without `--server`, `ssr-boost dev` starts the Express dev Vite
server and reads the managed server from its plugin options. The Express server keeps that Vite
server, so an ordinary start evaluates the config file once, as in 8.6, with or without the flag. A
project that picks the node server closes it first, so its config file is evaluated three times (the
server pick, HTTPS and the Vite server), or twice with `--server node`. `--reset-cache` resolves the
config once more before the start, whichever server runs. Keep side effects in it (logging, writing
files) safe to repeat.

## Check the upgraded application

Run development and production builds, then check hydration, lazy-route JS/CSS, redirects, unmatched-route 404s, error middleware and any HTML transform. If you use parsed request bodies, streaming or cancellation, exercise those paths too.

In the current documented release, loader and action promises stream by default. Return deferred fields inside the result object and consume them with Suspense and `<Await>`, or React 19 `use()`. Custom `getState` snapshots still use JSON and must not contain promises or rich values. See [Stream loader data](/guide/data-streaming) for the supported value contract, and consult the matching version documentation for older releases.
