# Getting Started

## Create a new app

Requires Node.js `22.12.0` or newer. Create an app with the `minimal` template (default):

```bash
npm create @lomray/ssr-app@latest my-app
cd my-app
npm run develop
```

The [create-ssr-app README](https://github.com/Lomray-Software/create-ssr-app#templates) describes the templates:

- `full`: Streaming SSR, MobX, consistent Suspense, meta tags and route management
- `minimal` (default): Six runtime dependencies, loaders, a lazy route with CSS, redirect, client-only route and 404, plus the SPA-to-SSR file diff
- `custom-server`: Development through the managed CLI, production through an application-owned Fastify server with static assets, compression and Early Hints; dual export of the managed entry and a Fetch handler
- `localization`: i18next with the language chosen on the server from the cookie or Accept-Language, transferred to the client before hydration, and a cookie-based switcher

With npm, put flags after `--` so npm forwards them to the scaffolder:

```bash
npm create @lomray/ssr-app@latest my-app -- --template full
```

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `-t, --template <name>` | `minimal` | `full`, `minimal`, `custom-server`, or `localization`. |
| `--no-install` | Install | Skip installation and print the install command in Next steps. |
| `--no-git` | Initialize git | Skip git initialization; remove `.husky/` and `scripts.prepare`. |
| `-y, --yes` | Off | Accept defaults without prompts. |

## Install

For an existing Vite app, install the package and follow the setup below.

```bash
npm i @lomray/vite-ssr-boost
```

Requires Node `>=22.12.0`, React/React DOM `>=18.2`, React Router `>=7` and Vite `>=5`.
Use matching React and React DOM versions. Node 22.12 works with React Router 7 and Babel 7;
newer major versions can require a newer Node release. React Router 8 requires React 19.
The [template](https://github.com/Lomray-Software/vite-template) includes compatible dependencies
and complete client/server entries.

## Add the Vite plugin

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import SsrBoost from '@lomray/vite-ssr-boost/plugin';

export default defineConfig({
  root: 'src',
  publicDir: '../public',
  build: {
    outDir: '../build',
  },
  plugins: [SsrBoost(), react()],
});
```

That is the minimal setup. The plugin handles SSR flags, route normalization and optional helpers such as SPA index generation or tsconfig aliases.

## Create the browser entry

```tsx
import entryClient from '@lomray/vite-ssr-boost/browser/entry';
import App from './App';
import routes from './routes';

void entryClient(App, routes);
```

`entryClient` does two important things for you:

- preloads matched lazy routes before router creation so SSR hydration can stay in sync
- chooses hydration or plain SPA mount depending on SSR mode and `data-force-spa`

## Create the server entry

```tsx
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';
import App from './App';
import routes from './routes';

export default entryServer(App, routes);
```

Add [lifecycle hooks](/guide/server-lifecycle) when you need request state, authentication,
metadata or crawler-specific rendering. For a custom HTTP server, see [runtime adapters](/guide/runtime-adapters).

## HTML shell

Place this in `src/index.html`. The outlet marks where the React stream goes. The browser entry
waits for the serialized state (or `DOMContentLoaded`) before creating the router and hydrating,
so the client script may be `async` and Vite may hoist it into `<head>`.

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>My app</title></head>
  <body>
    <div id="root"><!--ssr-outlet--></div>
    <script type="module" src="/client.ts"></script>
  </body>
</html>
```

## Replace scripts

```json
{
  "scripts": {
    "develop": "ssr-boost dev",
    "build": "ssr-boost build",
    "build:spa": "ssr-boost build --focus-only client",
    "start:ssr": "ssr-boost start",
    "start:spa": "ssr-boost start --focus-only client",
    "preview": "ssr-boost preview"
  }
}
```

`start:spa` above is the explicit form. Older examples often used `--only-client`, but the current CLI works through `--focus-only`.
Run `build:spa` before `start:spa`. For SSR, use `build` followed by `start:ssr`.

## Run it

```bash
npm run develop
```

### Development cold start

On an empty Vite cache, dependencies discovered during the first page load can cause an
`Invalid hook call` or a `useContext` error until Vite reloads the page. The plugin pre-bundles
its browser entry, components and route helpers with their React dependencies before that
first load. Existing optimization options are preserved. Use `optimizeDeps.exclude` to opt
out for a package or a specific deep import.

## Recommended project shape

```txt
src/
  App.tsx
  client.ts
  server.ts
  routes.tsx
  index.html
public/
vite.config.ts
```

You can move files around, but the defaults assume `client.ts`, `server.ts` and `index.html`. If you change that, configure the plugin options instead of relying on convention by accident.

Without TypeScript aliases, use `SsrBoost({ tsconfigAliases: false })`. For JavaScript projects,
also set `clientFile: 'client.js'` and `serverFile: 'server.js'`, and update the HTML script path.
