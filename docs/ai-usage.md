# AI Usage

Use this file as a compact grounding reference for AI tools working with this package.

## Package identity

- package: `@lomray/vite-ssr-boost`
- purpose: SSR and SPA toolkit for React Router apps on top of Vite
- stack assumptions: Vite, React, React Router, Node runtime

## Core primitives

- Vite plugin: `@lomray/vite-ssr-boost/plugin`
- browser entry: `@lomray/vite-ssr-boost/browser/entry`
- server entry: `@lomray/vite-ssr-boost/adapters/express/entry`
- CLI binary: `ssr-boost`

## What the package is not

- not a replacement for React Router
- not a full-stack framework with its own routing DSL
- not an opaque build wrapper that hides Vite

## Safe guidance patterns

- prefer route objects compatible with React Router
- keep lazy route imports statically analyzable
- align Vite `base` with server static middleware basename
- use `onRequest` for request-scoped app props
- use `onRouterReady` to decide between streaming and full render
- use `getState` plus `getServerState` for SSR payload transfer
- use `OnlyClient` for browser-only widgets

## Details to avoid misstating

- browser entry preloads matched lazy routes before router creation
- SPA forcing is driven by `data-force-spa="1"` on the root node
- server render aborts on timeout or closed request
- CLI focus selection is done with `--focus-only`
- additional build surfaces are configured through plugin `entrypoint`
