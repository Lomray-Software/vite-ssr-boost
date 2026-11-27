# Node development helpers

Use these helpers to run Vite development with HMR on your own `node:http` or `node:https` server.
The server entry must export `defineEntry(App, routes)` from `core/entry`; see
[Managed node server](/guide/runtime-adapters#managed-node-server). `ssr-boost dev --server node`
uses the same helpers.

```ts
import { createDevServer, prepareDev } from '@lomray/vite-ssr-boost/node/dev';
import type {
  ICreateDevServerOptions,
  IDevApp,
  IDevServer,
  IPrepareDevOptions,
} from '@lomray/vite-ssr-boost/node/dev';
```

Vite is imported when a helper runs, so production code that never calls them does not load it.

## `createDevServer`

```ts
interface ICreateDevServerOptions extends Omit<IPrepareDevOptions, 'server'>, ILifecycleOptions {
  compression?: boolean | { format?: 'gzip' | 'deflate' }; // Default: false
  logger?: IErrorLogger;
}

interface IDevServer extends IDevApp {
  lifecycle: ILifecycle;
  listen: (port?: number, host?: string) => Promise<AddressInfo | string | null>;
}

function createDevServer(options?: ICreateDevServerOptions): Promise<IDevServer>;
```

Creates the server, then mounts health probes, Vite middleware and SSR in that order. HTTPS comes
from `server.https` in your Vite config, resolved once when the server is created; restart the
process after changing certificates. That read resolves the config with its plugins, so a plugin
that sets `server.https` in its `config` hook is honoured, and `configResolved` hooks run once for
it and once more for the Vite server. A `ca`, `cert`, `key` or `pfx` string that holds a PEM block
(`-----BEGIN `) is used as it is, and any other string is read as a file path; a file that cannot be
read stops the start with its path instead of being passed on as a value. Under `ssr-boost dev`
without `--server`, an Express dev Vite server starts before that to pick the managed server and is
closed first, so the config file is evaluated once more and its `configureServer` hooks run for it;
keep its side effects safe to repeat. `close()` drains the server, then closes Vite with its HMR
clients, so a response still rendering completes. Lifecycle options are described in
[Node production](/api/node-production#createlifecycle).

```ts
const dev = await createDevServer({ health: true });

await dev.listen(3000);
dev.lifecycle.handleSignals({ onExit: (code) => process.exit(code) });
```

## `prepareDev`

```ts
interface IPrepareDevOptions {
  server: Server; // Parent HTTP(S) server; HMR attaches to it
  mode?: string; // Default: vite.mode, then 'development'
  entrypointName?: string;
  isHost?: boolean;
  port?: number;
  vite?: InlineConfig; // Merged under the managed settings
  config?: ServerConfig;
  loadEntry?: (vite: ViteDevServer, file: string) => Promise<unknown>;
}

interface IDevApp {
  viteMiddleware: Connect.Server;
  handler: SsrHandler;
  config: ServerConfig;
  vite: ViteDevServer;
  server: Server;
  close: () => Promise<void>;
}

function prepareDev(options: IPrepareDevOptions): Promise<IDevApp>;
```

Use it when your framework owns the server. Vite runs in middleware mode with `appType: 'custom'`
and attaches HMR to `server` instead of opening a port of its own. Mount `viteMiddleware` before
the handler and pass the URL the browser sent: Vite strips the base path from `req.url`, and keeps
the original in `req.originalUrl`.

```ts
import http from 'node:http';
import adapterNode from '@lomray/vite-ssr-boost/adapters/node';
import { prepareDev } from '@lomray/vite-ssr-boost/node/dev';

const server = http.createServer();
const dev = await prepareDev({ server });
const render = adapterNode(dev.handler);

server.on('request', (req, res) => {
  dev.viteMiddleware(req, res, () => {
    req.url = req.originalUrl ?? req.url;
    void render(req, res);
  });
});
server.listen(3000);
```

The handler loads the entry through `ssrLoadModule` with mapped stack traces on every request, so
server edits apply on the next request. The document is read and passed through
`transformIndexHtml` only when the entry renders; an `onRequest` that returns a `Response` skips it.
Route styles and scripts come from the current module graph, so they survive edits. Client-only
entrypoints receive the transformed document on every route with `Cache-Control: no-cache`.

Development route assets live in one cache per process, tied to the latest config and Vite that
asked for them. Two `prepareDev` apps in one process rebuild it whenever requests alternate between
them, so run one development server per process. A `config` passed in belongs to one project:
every start on it reads the root, the entry and the shell from the Vite that started on it last.

`close()` closes Vite, its watcher and HMR clients; the parent server stays open. It closes the
instance a restart left on `config`, and `viteMiddleware` keeps serving after a Vite restart.
