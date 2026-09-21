# Request guard, 404 modes and render admission

These Fetch-level options are available on `createHandler`, `createWorkerHandler`, the testing kit and the managed Express [server entry](/api/server-entry). The managed `ssr-boost dev` server uses the same pipeline. No additional dependencies are required.

::: warning Behavior change: the guard is on by default
Document requests using PUT, DELETE, PATCH or OPTIONS now receive **405** before `onRequest`. Applications serving APIs or CORS preflights through that hook must extend `requestGuard.methods`. Malformed targets receive **400** or **414**; script-extension and dotfile probes receive a plain **404**. Set `requestGuard: false` to retain the previous request/404 behavior.
:::

## Request guard

Checks run before `onRequest`, HTML loading, SSR policy and route loaders. The first rejection wins: method, target size, path shape, blocked probes, structural route matching, then the optional application decision. HEAD follows the existing render pipeline and drops the response body.

| Option                     | Default                   | Meaning                                                                                                                  |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `requestGuard`             | enabled                   | Options object, or `false` to disable                                                                                    |
| `methods`                  | `['GET', 'HEAD', 'POST']` | Allowed document methods; POST actions work by default                                                                   |
| `maxTargetBytes`           | `8192`                    | UTF-8 bytes in pathname plus search                                                                                      |
| `maxPathBytes`             | `2048`                    | UTF-8 pathname bytes                                                                                                     |
| `maxQueryBytes`            | `6144`                    | UTF-8 query bytes, excluding `?`                                                                                         |
| `maxSegments`              | `32`                      | Nonempty path segments                                                                                                   |
| `maxSegmentBytes`          | `1024`                    | UTF-8 bytes per path segment                                                                                             |
| `encodedDelimiters`        | `'allow'`                 | `'reject'` rejects `%2f`, `%5c`, `%23`, `%3f`, including the second-decoding re-test                                     |
| `blockedExtensions`        | script probes             | `php` plus digits, `phtml`, `phar`, `asp`, `aspx`, `jsp`, `jspx`, `cgi`, `cfm`, `cfml`, `action`, `do`, `faces`, `shtml` |
| `blockDotfiles`            | `true`                    | Blocks dotfile segments such as `/.env` and `/.git/config`; `/.well-known/*` is exempt                                   |
| `notFound`                 | `'render'`                | Missing-route behavior below                                                                                             |
| `admission.maxConcurrency` | unset                     | No controller, counters, listeners or timers unless enabled by this option or a valid environment override               |
| `admission.overload`       | `'reject'`                | Immediate overload response; no queue                                                                                    |

Invalid percent encoding, control characters, backslashes, doubled slashes and `.`/`..` segments are rejected before and after decoding. Node, Express and Fastify preserve raw targets before Fetch URL normalization. Fetch-native transports can only validate the URL their runtime exposes; a previously normalized target cannot be recovered.

`blockedExtensions` accepts a RegExp over the decoded pathname, a literal extension array, or `false`. Arrays replace the default list. Case-insensitive default probes allow an optional trailing slash. Resource routes such as `/sitemap.xml` pass the default guard. An unmatched path ending in a file-like extension of 1–8 letters/digits always receives a plain 404, regardless of `notFound`. A catch-all route is a structural match; use `decide` if it should trigger a 404 mode.

```ts
requestGuard: {
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  decide: async ({ request, url, matches }) => {
    // Return 'allow', 'notFound', a Response, or undefined.
    return undefined;
  },
  onReject: ({ request, reason, status }) => {
    metrics.increment('request.rejected', { reason, status });
  },
}
```

`decide` runs only after a structural match. `onReject` reasons are `method`, `target-too-large`, `malformed-target`, `blocked-extension`, `route`, and `decide`. Throwing observation hooks are ignored. Built-in rejections use `text/plain; charset=utf-8`, `Cache-Control: private, no-store`, short bodies and no HEAD body; 405 includes `Allow`. A Response returned by `decide` retains the application's response contract.

## Missing routes

`notFound` applies to unmatched document routes and `decide: () => 'notFound'`, only while the guard is enabled:

- `'render'`: continue through the existing router/render pipeline.
- `'spa'`: return the existing SPA shell with status 404. Detected bots receive router rendering when `ssr.bots` is `'ssr'` (the default).
- `'cached'`: buffer an anonymous router 404 once per key at runtime. Subsequent requests receive the stored HTML. Concurrent misses for the same key share one render.
- A `Response`, or `(request) => Response | Promise<Response>`: clone the response for each request and use status 404.

404 documents default to `Cache-Control: private, no-store`. Document header rules can override this baseline. Render failures and overload responses preserve their error status; they never populate the 404 cache.

```ts
notFound: {
  mode: 'cached',
  key: (request) => new URL(request.url).pathname.split('/')[1],
  maxEntries: 16,
},
```

The default key is `''`, with 16 entries and least-recently-used eviction. Cache state lasts for the handler's process/isolate lifetime. Cache misses use a GET Request with Cookie and Authorization stripped **before request hooks**. HEAD can warm the full cached document and receives no body. Render errors, thrown hooks, body-read errors and non-404 router results are not cached. Cache hits skip request/render hooks, loaders and admission. A `Set-Cookie` issued during the anonymous render is never stored or replayed.

::: warning Anonymous cache scope
Choose keys that cover every variation your anonymous 404 uses (for example locale). The default shared key also shares the rendered URL and hydration data across missing paths. Avoid request-specific state in a shared 404. When the render has a CSP `nonce` configured, caching is disabled and the request follows `'render'` instead; a cached nonce must never be reused.
:::

## Render admission

```ts
admission: {
  maxConcurrency: 32,
  overload: 'reject',
  onEvent: ({ outcome, active, durationMs }) => {
    metrics.observe('ssr.admission', { outcome, active, durationMs });
  },
},
```

A valid `SSR_MAX_CONCURRENCY` overrides the configured limit. It is read once at handler/entry creation, defensively in runtimes without `process`. Invalid or missing environment values are ignored. `ssr-boost doctor` reports whether the variable is set and valid; it does not inspect application guard options.

A slot is acquired after the request hook and the SSR/SPA decision, before route loaders run, so a rejected request costs neither a render nor backend calls. Guard rejections, SPA shells, cached hits and request-hook bypasses do not acquire slots. Slots release exactly once on completion of the final response stream, cancellation/disconnect, loader or render failure, HEAD/bodyless responses and redirects.

At capacity, `'reject'` returns a plain 503 `Service Unavailable`, `Retry-After: 1` and `private, no-store`. `'spa'` returns the SPA shell with 200 for humans, so the client router takes over; detected bots still receive the plain 503. Events are `admitted`, `rejected`, `finish`, `abort`, and `error`; terminal events include `durationMs`. Throwing event hooks do not affect responses.

## Hardening preset

This preset intentionally blocks asset/resource routes reaching the document handler. Serve those assets before it, and extend the methods if the application handles API requests or preflights through `onRequest`.

```ts
entryServer(App, routes, {
  requestGuard: {
    methods: ['GET', 'HEAD'],
    maxSegments: 8,
    maxSegmentBytes: 512,
    encodedDelimiters: 'reject',
    blockedExtensions:
      /\.(?:php\d*|phtml|phar|asp|aspx|jsp|jspx|cgi|cfm|cfml|action|do|faces|shtml|avif|css|eot|gif|html?|ico|jpe?g|js|json|map|png|svg|ttf|txt|webp|woff2?|xml)\/?$/i,
  },
  notFound: 'cached',
  admission: { maxConcurrency: 32 },
});
```
