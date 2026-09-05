# Development diagnostics

Diagnostics catch state serialization and response-hook mistakes before they reach the browser.
Each distinct warning is logged once per process through the existing logger, with a stable code,
the affected route/key or file, and a link to its section below; managed development uses your
configured `loggerDev`. Reloading a development module does not reset this deduplication.

Checks are on for `ssr-boost dev` and off for `ssr-boost start` and managed serverless deployments.
Fetch [`createHandler`](/guide/runtime-adapters#create-a-fetch-handler) accepts `diagnostics?: boolean`,
defaulting to `process.env.NODE_ENV !== 'production'` (on if `process` is unavailable).
`SSR_BOOST_DIAGNOSTICS=0` disables the checks and `SSR_BOOST_DIAGNOSTICS=1` enables them, overriding
both the option and managed CLI mode wherever environment variables are available.

When enabled, diagnostics walk state before serialization and retain a copy of emitted HTML until
the response finishes, without delaying streamed chunks. When disabled, they neither walk state nor
accumulate HTML. Completed-output checks skip cancelled or failed streams, redirects, and bodyless
responses; invalid file-backed shells always throw, even with diagnostics disabled.

## SSR_BOOST_LOADER_NOT_SERIALIZABLE {#ssr_boost_loader_not_serializable}

### When it appears

A loader or action returns a Promise, function, Map, Set, WeakMap, WeakSet, BigInt, Symbol, or class
instance anywhere inside plain objects or arrays. The warning names the React Router route id and
key path, such as `loaderData["details"].items[0].result`; Dates are reported as “hydrates as a string”,
and circular references are reported too.

### Why it matters

Router hydration uses JSON, so a nested Promise or Map becomes `{}` and functions or symbols can
disappear. BigInts and cycles make serialization throw, while Dates lose their Date methods after
hydration.

### How to fix

Await loader data needed for the initial page and return plain JSON data at the reported path.
Convert collections to arrays or objects, class instances to explicit data fields, and BigInts or
Dates to strings with deliberate client-side reconstruction; keep streamed work in the application's
Suspense mechanism instead of placing Promises in router hydration data.

## SSR_BOOST_STATE_NOT_SERIALIZABLE {#ssr_boost_state_not_serializable}

### When it appears

The object returned by `getState` contains one of the unsupported values listed above, including
nested values inside arrays and plain objects. The warning identifies the request route and a path
such as `$.store.items[0].createdAt`, even when the state builder would otherwise omit the value.

### Why it matters

Custom state is serialized into browser scripts using JSON just like router state. A server store
containing class instances or collections can therefore hydrate with missing fields or changed types.

### How to fix

Return a plain snapshot of your store from `getState`, with awaited values and explicit fields.
Convert Dates to ISO strings and collections to plain data, then rebuild the client store from that
snapshot rather than returning the live store instance.

## SSR_BOOST_OUTLET_MISSING {#ssr_boost_outlet_missing}

### When it appears

The managed server or `loadHtmlShell` finds zero or multiple `<!--ssr-outlet-->` markers (or an invalid
custom outlet), and throws an Error naming the HTML file in every mode. For Fetch handlers, the
pre-split `{ header, footer }` shell represents one insertion boundary; diagnostics warn if either
half is missing or a raw outlet remains in either half.

### Why it matters

The outlet determines where React content goes and where the hydration footer begins. An absent or
duplicate boundary can put content outside the document or discard the footer entirely.

### How to fix

Place exactly one `<!--ssr-outlet-->` inside the application's root element in `index.html`, and make
sure HTML transforms preserve it. For file-backed Fetch shells use `loadHtmlShell({ indexFile })`
to validate the source before splitting it; manually supplied halves must both be strings, which
may be empty, and must not retain the marker.

## SSR_BOOST_HYDRATION_STATE_MISSING {#ssr_boost_hydration_state_missing}

### When it appears

A completed development response has no script assigning `window.__staticRouterHydrationData`.
This commonly follows an `onResponse` hook that withholds the footer or removes its hydration script.

### Why it matters

The browser entry needs router hydration data to start with the same loader and action state as the
server. Removing that script prevents the page from hydrating correctly even if its HTML looks complete.

### How to fix

Preserve the generated hydration script when transforming footer chunks. If your hook retains
chunks by returning `''`, return the remaining content on the final `isEnd: true` call, including
the hydration state and document footer.

## SSR_BOOST_DUPLICATE_OUTPUT {#ssr_boost_duplicate_output}

### When it appears

A completed development response repeats an `<html>` or `<head>` opening tag, a router hydration
script, a React segment/boundary `id="S:…"` or `id="B:…"`, or a `$RC("B:…", …)` call for the same id.
The warning names the repeated marker; one boundary id and its matching `$RC` call are expected and
are counted separately.

### Why it matters

Repeated document or hydration output can corrupt the page, and repeated React streaming markers
can apply Suspense content more than once. A hook that retains a chunk but returns `undefined`
accidentally emits it now and may emit it again at the end.

### How to fix

`onResponse` must return `undefined` to keep a chunk and `''` to withhold one, then return retained
content exactly once on the final call. Check head-manager integration too: insert head contents
into the existing `<head>` rather than adding a second opening tag.

## SSR_BOOST_ONRESPONSE_INVALID_RETURN {#ssr_boost_onresponse_invalid_return}

### When it appears

`onResponse` returns something other than a string or `undefined`, including on its final call.
The warning names the route and actual return type, such as Promise, Object, number, or null.

### Why it matters

The hook is synchronous and its return value directly controls the outgoing chunk. An async hook
returns a Promise that is not awaited, so the response can contain `[object Promise]` instead of HTML.

### How to fix

Make `onResponse` synchronous and return a string to replace a chunk, `undefined` to keep it, or `''`
to withhold it. Do asynchronous preparation in an earlier async lifecycle hook and let the final
`isEnd: true` call return only any remaining HTML string.
