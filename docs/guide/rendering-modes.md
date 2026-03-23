# Rendering Modes

## SSR mode

SSR mode is the default mental model of the package.

In SSR mode:

- the browser entry hydrates existing HTML
- the server entry uses `createStaticHandler`
- the server can stream the shell or wait for the full tree
- redirect and status components can write to the server response context

This is the mode to use when first paint, crawler behavior, response status control or request-aware rendering actually matter.

## SPA mode

The same app can run as SPA without changing your route structure.

There are two common paths:

1. run or build only the client side
2. generate an extra SPA-only index file and force client mount

The package uses `data-force-spa="1"` on the generated SPA index to tell the browser entry to skip hydration and render as a pure client app.

## Switching between SSR and SPA

This is one of the practical strengths of the package.

- During normal SSR, `entryClient` hydrates.
- During SPA fallback, `entryClient` mounts with `createRoot`.
- During additional SPA entrypoint builds, the plugin can emit `index-spa.html`.

That means one route tree can serve:

- the main SSR app
- a service worker shell
- a mobile or embedded SPA entry
- extra product surfaces from custom entrypoint builds

## Streaming or waiting for all HTML

By default the renderer is stream-oriented.

Inside `onRouterReady` you can return:

```ts
{
  isStream: false,
}
```

Use that when a specific request should wait for full HTML instead of streaming. A common case is crawler-specific behavior or HTML mutation that depends on the full document.

## When SPA is the better choice

Use SPA output when:

- you need a service-worker-friendly offline shell
- you build an embedded app where server response codes are irrelevant
- the route surface is private and does not benefit from SSR
- you want a custom entrypoint for Capacitor or another app shell

Use SSR when:

- you need response status or redirect control
- you care about crawler-visible HTML
- you want request-aware rendering
- you want stream rendering and Suspense on the server
