# Node production helpers

Use these helpers when your application owns its Node HTTP server and serves a build produced by
the SSR BOOST CLI. They supply the `getHtml` and `prepare` options for `core/handler`.

```ts
import {
  createRouteAssetPreparer,
  loadHtmlShell,
} from '@lomray/vite-ssr-boost/node/production';
import type {
  IHtmlShell,
  ILoadHtmlShellOptions,
  IRouteAssetPreparerOptions,
  TRouteAssetsManifest,
} from '@lomray/vite-ssr-boost/node/production';
```

The explicit `.js` import path also works. These helpers use Node's filesystem APIs.

## `loadHtmlShell`

```ts
interface ILoadHtmlShellOptions {
  indexFile: string;
  outlet?: string; // Default: '<!--ssr-outlet-->'
}

function loadHtmlShell(options: ILoadHtmlShellOptions): Promise<() => IHtmlShell>;

interface IHtmlShell {
  header: string;
  footer: string;
}
```

Reads the UTF-8 file once and splits it at the outlet. The file must contain exactly one outlet;
an empty outlet, missing outlet or repeated outlet throws an error naming the file. Filesystem
read errors propagate to the caller.

The returned function creates a new `{ header, footer }` object each time, so request hooks can
change the shell without affecting other requests. It can be passed directly as `getHtml`.
Load a new shell when deploying a new build.

## `createRouteAssetPreparer`

```ts
type IRouteAssetPreparerOptions = (
  | { buildDir: string; manifest?: never }
  | { manifest: TRouteAssetsManifest; buildDir?: never }
) & { modulePreload?: boolean }; // Default: false

function createRouteAssetPreparer<TAppProps>(
  options: IRouteAssetPreparerOptions,
): NonNullable<ICreateHandlerOptions<TAppProps>['prepare']>;
```

`ICreateHandlerOptions` is the type exported by `core/handler`.

Pass the build directory containing `client/` and `server/`. The preparer resolves this path when
created, then reads `server/assets-manifest.json` when a request first has matched routes. Each
preparer caches its own manifest and shares the managed server's asset injection logic. It does
not discover builds from the working directory or use the managed server's manifest singleton.
Relative paths resolve against the working directory at creation; use an absolute path to start
the application from any directory.

Alternatively, import the parsed **`build/client/assets-manifest.json`** and pass `{ manifest }`:

```ts
import manifest from './build/client/assets-manifest.json';
const prepare = createRouteAssetPreparer({ manifest });
```

The CLI emits this alongside the identical `build/server/assets-manifest.json` after the normal
server build. It is not Vite's `.vite/manifest.json`. The exported `TRouteAssetsManifest` type accepts
a JSON import directly. `RouteAssets` from `services/route-assets` also accepts the object as its
first constructor argument, with `modulePreload` as the second. Manifest objects are not mutated.
For Workers use the edge-safe [Cloudflare entry](/guide/cloudflare), which uses the same injection
logic without importing the Node helpers.

The hook runs after React Router matches the request. It inserts matching route styles and scripts
before `</head>` in `context.html.header`; the shell must contain that closing tag. Lazy route IDs
must match the routes used for the build. `modulePreload: true` also inserts module preload links.
Asset URLs come from the manifest, including any base path configured during the build.

When the assets produce `Link` headers, the hook awaits `executionContext.onEarlyHints` if provided.
It works without that callback. The Node and Fastify adapters send these headers as HTTP 103 Early
Hints when the transport supports them. They are separate from the final response headers.

A missing manifest or a route without assets adds nothing, matching the managed server. Invalid
manifest JSON and read errors propagate. Create a new preparer when deploying a new build.

See the [Fastify launcher](/guide/runtime-adapters#adapters) for the complete server setup,
including static files and compression.
