# Vite SSR BOOST

<p align="center">
    <img src="https://raw.githubusercontent.com/Lomray-Software/vite-ssr-boost/prod/logo.png" alt="Vite SSR BOOST logo" width="250" height="250">
</p>

SSR and SPA toolkit for React Router apps on top of Vite.

It is built for applications that want to keep Vite and React Router visible, but still need the practical runtime layer for SSR, SPA fallback, streaming, custom entrypoints and deployment-oriented builds.

## Why use it

- SSR and SPA from one route tree
- React Router on both client and server
- stream rendering with request lifecycle hooks
- a Vite-native plugin and CLI flow
- a Fetch-based SSR core with Node, Express, Fastify, Hono and edge adapters
- response-aware helpers such as redirects and status codes
- custom entrypoints for mobile, embedded and service-worker-friendly shells

<p align="center">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=reliability_rating" alt="reliability">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=security_rating" alt="Security Rating">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=sqale_rating" alt="Maintainability Rating">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=vulnerabilities" alt="Vulnerabilities">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=bugs" alt="Bugs">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=ncloc" alt="Lines of Code">
  <img src="https://sonarcloud.io/api/project_badges/measure?project=vite-ssr-boost&metric=coverage" alt="code coverage">
  <img src="https://img.shields.io/npm/v/@lomray/vite-ssr-boost?label=semantic%20release&logo=semantic-release" alt="semantic version">
</p>

## Install

```bash
npm i @lomray/vite-ssr-boost
```

Use Node 22 or newer. Start with the [React template](https://github.com/Lomray-Software/vite-template):

```bash
git clone https://github.com/Lomray-Software/vite-template.git
cd vite-template
npm ci
npm run develop
```

For production, run `npm run build` and `npm run start:ssr`. For a static SPA, run
`npm run build:spa` and `npm run start:spa`.

## Documentation

Full documentation lives here: [lomray-software.github.io/vite-ssr-boost](https://lomray-software.github.io/vite-ssr-boost/)

Existing Express applications move one import to `adapters/express/entry`; hooks are unchanged. See
[runtime adapters](https://lomray-software.github.io/vite-ssr-boost/guide/runtime-adapters)
for the Fetch API and the differences between the managed CLI server and a custom runtime.

## License

Made with 💚

Published under [MIT License](./LICENSE).
