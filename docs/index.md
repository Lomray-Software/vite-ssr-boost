---
layout: home

hero:
  name: Vite SSR BOOST
  text: SSR for React Router apps in Data mode.
  tagline: Keep your Vite config, route objects and components. Add SSR without moving to Framework mode or rewriting the app.
  image:
    src: /logo.png
    alt: Vite SSR BOOST logo
  actions:
    - theme: brand
      text: Migrate a SPA
      link: /guide/migrate-existing-spa
    - theme: alt
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/Lomray-Software/vite-ssr-boost

features:
  - icon: 🧩
    title: Keep your app
    details: Reuse React Router route objects and components. Add the SSR plugin and entries to your Vite project.
  - icon: 🔀
    title: SSR and SPA output
    details: Build and serve either mode with the same route tree and browser entry.
  - icon: 🛠️
    title: Start with the managed CLI
    details: Express handles development with Vite and HMR, production static assets and route-asset injection.
  - icon: 🔌
    title: Own the transport when needed
    details: Connect the Fetch core through Node, Express, Fastify, Hono or edge adapters, and supply the server and asset delivery.
---

## Who this is for

`@lomray/vite-ssr-boost` adds SSR to Vite apps using React Router [Data mode](https://reactrouter.com/start/modes). You keep route objects and choose how to run the server. The package does not implement React Server Components, Server Actions or file-system routing conventions.

## Start with the managed server

Add `SsrBoost()` to the Vite plugins, use `@lomray/vite-ssr-boost/browser/entry` in the browser entry and `@lomray/vite-ssr-boost/adapters/express/entry` in the server entry. The CLI handles development, HMR, SSR builds and SPA builds. Use the [Fetch core and runtime adapters](/guide/runtime-adapters) when your application needs to own the transport and its asset integration.

## Read this first

- [Choosing an SSR approach](/guide/choosing) compares routing, data and server ownership.
- [Migrate an existing SPA](/guide/migrate-existing-spa) shows the five-file change from the minimal template.
- [Example projects](/examples/) describes the template branches.
- [FAQ](/reference/faq) answers questions about RSC, SPA output and runtimes.
- [Getting Started](/guide/getting-started) covers installation and entry files.
- [Rendering Modes](/guide/rendering-modes), [Routing](/guide/routing) and [Server Lifecycle](/guide/server-lifecycle) explain application behavior.
- [Hydration order and streaming](/reference/hydration-and-streaming) explains when the browser can safely create its router.
- [Deployment](/guide/deployment) covers build targets; [Recipes](/examples/recipes) shows integrations.
