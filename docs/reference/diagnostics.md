# Development diagnostics

Run [`ssr-boost doctor`](/api/cli#ssr-boost-doctor) to check project setup before investigating a runtime warning. Use `doctor --json` in automation and `doctor --bundle support.json` to collect versions, route structure, checks and recorded build codes without request data.

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

## SSR_BOOST_CACHE_PRIVATE_LEAK {#ssr_boost_cache_private_leak}

A final response is explicitly public while carrying Set-Cookie or while the request
contains the configured `sessionCookie`. Use `documentHeaders` with its default
credential protection and bypass shared cache reads and writes for that cookie.
The warning is deduplicated and never prints cookie values. Like other development
checks, it is disabled in production unless diagnostics are explicitly enabled.
See [Document headers and caching](/guide/caching) for the helpers and tested recipes.

## SSR_BOOST_DEPRECATED_REQ_RES {#ssr_boost_deprecated_req_res}

A managed Express hook or loader reads `context.req` or `context.res`. These fields still return
the live Express objects, but are deprecated in 8.x with removal planned for **9.0**, subject to
the [support policy](/reference/support) notice periods. One warning covers both fields across
all requests, hooks and development module reloads in the process. Merely creating the context
or reading `context.request` does not warn.

Use `context.request` for the Fetch request's URL, headers, method and signal. Before the shell
is sent, set `context.response.headers` and `context.response.status` for response metadata;
use React Router's HTTP helpers such as `redirect()` in loaders/actions. The earlier managed
`onRequest(req, res)` arguments and Express middleware are not deprecated by this diagnostic.

Accessors are installed only in managed development with diagnostics enabled, using `loggerDev`.
`SSR_BOOST_DIAGNOSTICS=0` disables them. Production keeps plain properties with no accessor or
warning overhead, even when other diagnostics are enabled with `SSR_BOOST_DIAGNOSTICS=1`.

## SSR_BOOST_SSR_POLICY {#ssr_boost_ssr_policy}

An info message explains whether a URL pattern selected `ssr` or `spa`, and whether the decision came from the configured include/exclude policy, `decide`, `SSR_BOOST_SSR_ROUTES`, or `bots: 'ssr'`. It appears for active [incremental SSR policies](/guide/incremental-ssr), once per pattern and distinct decision per process, using the development logger and diagnostics settings above. Plain default `all` mode stays silent; an `all` policy with `decide` is active.

The message identifies patterns rather than concrete dynamic parameters, cookies or query values. Check it when a URL uses an unexpected mode. The environment override replaces the configured route policy and `decide`; bot protection has highest priority. This is informational and does not count as a warning. SPA shells intentionally have no hydration state and do not trigger `SSR_BOOST_HYDRATION_STATE_MISSING`.

## SSR_BOOST_SSR_POLICY_UNMATCHED {#ssr_boost_ssr_policy_unmatched}

An include/exclude pattern has no match among known route ids' declared URL paths. The warning checks nested paths and router basenames without importing lazy route modules or running loaders. A global 404 catch-all does not hide typos. Each distinct unmatched pattern warns once per process under the diagnostics settings above.

Check spelling, include the URL basename, and use path patterns rather than component filenames or generated numeric route ids. The check is advisory and compares declared paths, so a RegExp restricted to particular dynamic parameter values may need manual verification. Invalid path-to-regexp string syntax instead throws during entry/handler creation, even with diagnostics disabled.

## SSR_BOOST_TIMELINE {#ssr_boost_timeline}

Set `SSR_BOOST_TIMELINE=1` to record request stages even when diagnostics are disabled and print one JSON line per completed or cancelled request in development. The line includes the method, pathname and millisecond offsets for routing, preparation, shell readiness, state emission, deferred settlements (with promise ids), body/response completion and abort reasons. Recording is also enabled by diagnostics; logging requires the timeline environment flag and stays off in production. Hooks can inspect `context.timeline?.events`, and the testing kit exposes `await response.timeline()`. When diagnostics are off and the flag is unset, no timeline instance or event array is allocated. See [Request timeline](/guide/testing#request-timeline) for stage definitions; `response.end` measures consumption of the Fetch body, not delivery over a socket.

## SSR_BOOST_LOADER_NOT_SERIALIZABLE {#ssr_boost_loader_not_serializable}

### When it appears

A loader/action value or streamed resolution contains a function, symbol, unsupported class instance (including WeakMap/WeakSet), or circular reference. The warning identifies its route and key path. Promises, Dates, Maps, Sets, BigInts, RegExps and undefined are supported and do not trigger this warning.

### Why it matters

The [router data codec](/guide/data-streaming#supported-values) restores supported types. Unsupported values become `undefined`; custom class behavior is not transferred. Circular values are preserved within a frame but still warn so route data remains easy to inspect and reuse.

### How to fix

Return explicit data fields instead of functions or class instances, and remove cycles from your route data. Leave supported slow fields as promises and render them with Suspense and `<Await>` or React 19 `use()`.

## SSR_BOOST_STREAM_PROMISE_ABORTED {#ssr_boost_stream_promise_aborted}

A render timed out or was cancelled with loader/action promises still pending. The diagnostic names the route and pending count. Connected browsers receive rejection scripts before the response closes; cancelled response consumers discard queued frames. Increase `abortDelay` when the work legitimately needs longer, handle rejections with an error boundary, and pass the loader's `request.signal` to outbound fetches. The deadline starts after routing/preparation and also covers promises the React tree never reads. This diagnostic follows the development/explicit diagnostics settings above.

## SSR_BOOST_STATE_NOT_SERIALIZABLE {#ssr_boost_state_not_serializable}

### When it appears

The object returned by `getState` contains a promise, function, symbol, bigint, Date, collection, class instance or cycle, including
nested values inside arrays and plain objects. The warning identifies the request route and a path
such as `$.store.items[0].createdAt`, even when the state builder would otherwise omit the value.

### Why it matters

Custom state is serialized into browser scripts using JSON. Its value rules differ from router data. A server store
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
