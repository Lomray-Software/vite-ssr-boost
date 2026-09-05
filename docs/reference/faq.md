# FAQ

## Do I need React Server Components?

No. vite-ssr-boost renders your React component tree through its SSR renderer and hydrates it in the browser. It does not implement React Server Components or Server Actions; use the [migration guide](/guide/migrate-existing-spa) to add SSR to route objects.

## Is SSR without RSC obsolete?

No. React documents [streaming HTML with `renderToPipeableStream` and Suspense](https://react.dev/reference/react-dom/server/renderToPipeableStream) as a server rendering API. vite-ssr-boost uses that rendering model and browser hydration; RSC is not a prerequisite for it.

## Can I switch back to SPA?

Yes: run `npm run build:spa`, then `npm run start:spa` with the [example scripts](/guide/migrate-existing-spa#going-back-to-spa). Both commands use `--focus-only client`, keeping the same route objects and browser entry. Rebuild with `npm run build` before starting SSR again.

## Why not React Router Framework mode?

Choose [Framework mode](https://reactrouter.com/start/modes) when you want its Vite plugin, route module API and rendering configuration. Its [adoption guide](https://reactrouter.com/upgrading/router-provider) converts route definitions to route modules and adds a root entry. vite-ssr-boost adds SSR while keeping your Data-mode route objects and HTML entry.

## Why not Next.js?

Choose [Next.js App Router](https://nextjs.org/docs/app) when you want its file-system routing, Server Components and Server Functions. Its [Vite migration guide](https://nextjs.org/docs/app/guides/migrating/from-vite) starts with SPA behavior and describes moving from React Router to App Router for streaming. vite-ssr-boost keeps the Vite build and React Router route objects.

## Does it work on Bun, Deno, Cloudflare?

Yes, through the Fetch core, `@lomray/vite-ssr-boost/edge/render-to-stream` and `@lomray/vite-ssr-boost/adapters/edge`. Use the [runtime adapter integration](/guide/runtime-adapters#cloudflare-workers) with `Bun.serve`, `Deno.serve` or a Cloudflare Worker Fetch entry, and provide bundling, static assets and route-asset injection. Cloudflare bundles need the `workerd` and `worker` resolution conditions. The managed CLI and its Vercel/serverless output use Node and Express; they do not produce a Worker bundle.
