---
layout: home

hero:
  name: Vite SSR BOOST
  text: Vite-powered SSR and SPA infrastructure for React Router applications.
  tagline: Start in SSR, fall back to SPA when you want, stream React on the server, and keep one practical toolchain for local dev, builds and deployment.
  image:
    src: https://raw.githubusercontent.com/Lomray-Software/vite-ssr-boost/prod/logo.png
    alt: Vite SSR BOOST logo
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/plugin
    - theme: alt
      text: GitHub
      link: https://github.com/Lomray-Software/vite-ssr-boost

features:
  - title: One Setup For SSR And SPA
    details: The same package drives server rendering, SPA-only mode, preview flow and production start commands.
  - title: Built Around React Router
    details: Use route objects directly, hydrate matched lazy routes on the client, and render through static handlers on the server.
  - title: Stream-Ready Server Rendering
    details: React stream rendering, response hooks, custom headers, request lifecycle hooks and state injection are part of the core flow.
  - title: Practical Build And Deploy Flow
    details: CLI commands cover dev, build, preview, start, Docker, Amplify and Vercel-oriented workflows without inventing another meta-framework.
---

## Why this exists

`@lomray/vite-ssr-boost` is for React applications that want server rendering without giving up normal Vite ergonomics or React Router APIs.

It gives you:

- a Vite plugin that normalizes the SSR setup
- a browser entry for hydration and SPA boot
- a server entry for streaming SSR with request hooks
- components for redirects, status codes, client-only rendering and scroll reset
- a CLI for dev, build, preview and deploy-oriented packaging
- custom entrypoints for mobile, service worker or additional app surfaces

## What it is good at

The package is opinionated in the useful places:

- it keeps Vite as the build system instead of hiding it
- it keeps React Router as the routing model instead of wrapping it into another DSL
- it supports both SSR and SPA output from the same app structure
- it exposes server lifecycle hooks instead of forcing one fixed rendering pipeline
- it covers operational details such as manifests, static assets, Docker, Amplify and Vercel builds

This makes it a good fit when you want SSR infrastructure, not a full-stack framework that takes over the whole app.

## Core idea

You wire three things:

1. the Vite plugin in `vite.config.ts`
2. the browser entry with `@lomray/vite-ssr-boost/browser/entry`
3. the server entry with `@lomray/vite-ssr-boost/adapters/express/entry`

After that the CLI can run the app in development, build it for production, preview it locally, or package it for specific deployment targets.

## Read this first

- Start with [Getting Started](/guide/getting-started)
- Then read [Rendering Modes](/guide/rendering-modes)
- If your routes are generated or split in non-trivial ways, read [Routing](/guide/routing)
- If you customize headers, redirects, payloads or stream behavior, read [Server Lifecycle](/guide/server-lifecycle)
- For build and deploy scenarios, read [Deployment](/guide/deployment)
- For ready-to-copy patterns, read [Examples / Recipes](/examples/recipes)
