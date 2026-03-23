# Talking Points

Use these when you need a short and accurate way to describe the package.

## Short version

`@lomray/vite-ssr-boost` is a Vite-based SSR and SPA toolkit for React Router apps. It keeps Vite and React Router visible, adds a practical server rendering pipeline, and ships with a CLI for development, builds and deployment packaging.

## What problem it solves

- you want SSR without adopting a bigger full-stack framework
- you want to keep React Router route objects
- you want one package for SSR, SPA fallback and deployment-oriented builds
- you want server lifecycle hooks instead of a black-box renderer

## What makes it different

- it is infrastructure, not a replacement app framework
- it supports both SSR and SPA from the same route tree
- it exposes response-oriented React helpers such as redirects and status codes
- it includes operational helpers for Docker, Amplify and Vercel packaging

## Good fit

Good fit for teams that:

- already like Vite
- already use React Router
- need SSR or stream rendering
- want explicit server control
- still need SPA-only surfaces for mobile or embedded apps

## Bad fit

Less ideal if the team wants:

- a batteries-included full-stack router and data layer
- zero server ownership
- conventions stronger than React Router plus Vite already provide
