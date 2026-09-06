# Server Lifecycle

## Mental model

The server entry returns a render pipeline definition, not a started server.

At runtime the package:

1. creates or reuses server config
2. loads your server entry
3. calls `onRequest`
4. queries React Router static handler
5. decides whether to stream or wait
6. writes HTML, state and response mutations

That is where the customization hooks fit.

Render hooks receive a [context](/api/server-entry#hook-context) with the shared Fetch `request` and live Express `req` / `res`; `onRequest` receives `(req, res)` before that context is created.

Development requests also run [diagnostics](/reference/diagnostics) for non-serializable state,
invalid `onResponse` returns, missing hydration scripts and duplicate output, with stable warning
codes emitted once per distinct message. They are enabled for `ssr-boost dev`, disabled for
`ssr-boost start` and managed serverless, and controlled by the Fetch handler's `diagnostics` option;
`SSR_BOOST_DIAGNOSTICS=0|1` overrides either setting. Invalid HTML outlet counts always throw for
file-backed shells, including in production.

## `onServerCreated`

Called once after the Express app exists.

Use it for:

- custom middleware
- request logging middleware
- metrics registration
- extra endpoints outside the React app

## `onServerStarted`

Called once after the HTTP server starts listening.

Use it for:

- boot logs
- post-start probes
- integration with surrounding process managers

## `onRequest`

Called for every incoming request before rendering.

Return shape:

```ts
{
  appProps?: Record<string, unknown>;
  hasEarlyHints?: boolean;
  shouldSkip?: boolean;
  shouldCancel?: boolean;
}
```

Use it for:

- request-scoped app props
- auth or locale prep
- per-request state manager creation
- short-circuiting certain URLs

`shouldSkip` passes control to the next Express middleware. `shouldCancel` stops the current handling path completely.

## `onRouterReady`

Called after the static handler resolved and router context exists.

Return:

```ts
{
  isStream?: boolean;
}
```

This is the place to switch between streaming and full-document rendering based on user agent, route match or any other request-level policy.

## Promise streaming and hydration

Loader/action promises stream by default. Set `hydration: 'early'` in the lifecycle configuration (or Fetch handler options) to hydrate the parsed shell while boundaries are pending. The early block contains `getState` custom state before router state, so custom state must be available at `onShellReady`. Default footer ordering remains custom state, router state, footer. `nonce` applies to React and all generated scripts; `bootstrapScriptContent` is forwarded with the early shell marker prepended when enabled. See [Stream loader data](/guide/data-streaming).

## `onShellReady`

Replaces the template header or footer around the React stream. Generated hydration state is
preserved when replacing the footer. Custom state scripts from `getState` come first, followed by
router state and then the footer, so custom state is available when router state unblocks hydration.

Return:

```ts
{
  header?: string;
  footer?: string;
}
```

Typical uses:

- analytics bootstrap
- state container tags
- request-specific metadata

## `onResponse`

Receives `{ context, html, isEnd }` for HTML chunks as they are written, with `isEnd: false`.

Use it when you need to mutate generated HTML in transit, for example to inject payloads or patch chunks before they leave the server.

Return `undefined` (or return nothing) to keep the original chunk. A string replaces the chunk,
including `''`, which withholds it so an incremental transform can retain an unfinished token
until more HTML arrives.

After the composed body stream finishes, including its footer, the hook runs once more with
`html: ''` and `isEnd: true`. Return a string to append any retained content to the response;
`undefined` or `''` appends nothing. The same contract applies when `isStream` is `false`.
Existing hooks can ignore `isEnd`.

For example, with an `@lomray/consistent-suspense` stream transform stored in `appProps`:

```ts
onResponse: ({ context: { appProps: { streamSuspense }, isStream }, html, isEnd }) => {
  if (!isStream) return;
  return isEnd ? streamSuspense.end() : streamSuspense.analyze(html);
},
```

## `getState`

Returns serializable state that should be exposed to the client.

The package then writes it into the response payload so `helpers/get-server-state` can pick it up later on the client.

## `onShellError` and `onError`

`onShellError` lets you replace the default fatal shell HTML.

`onError` receives normalized stream error information, including timeout, abort or cancel scenarios. Use it for logging and observability, not for ad hoc HTML rendering.

## Abort behavior

The React render aborts when:

- `abortDelay` is exceeded
- the client disconnects before the response finishes
- a source or destination stream fails

Pending loader/action promises also reject on abort; connected browsers receive rejection scripts before closing. The timer remains active until both React and router promises finish, including unused data.

The timer starts after loaders and `onRouterReady` finish. Use the loader's `request.signal` for
outbound requests. Finishing the incoming request body does not cancel a response still streaming.
