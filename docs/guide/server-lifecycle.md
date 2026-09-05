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

The timer starts after loaders and `onRouterReady` finish. Use the loader's `request.signal` for
outbound requests. Finishing the incoming request body does not cancel a response still streaming.
