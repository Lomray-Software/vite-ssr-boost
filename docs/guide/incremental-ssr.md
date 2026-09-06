# Incremental SSR

Choose SSR or the SPA shell for each incoming URL in one application. Both modes use the same browser bundle and React Router route tree, so client navigation between them stays in the current document.

## Roll out public pages first

After [migrating your SPA](/guide/migrate-existing-spa), start with `include` and the public pages that need search indexing or link previews:

```ts
import entryServer from '@lomray/vite-ssr-boost/adapters/express/entry';
import App from './app';
import routes from './routes';

export default entryServer(App, routes, {
  ssr: {
    mode: 'include',
    routes: ['/', '/about', '/articles/:slug'],
    bots: 'ssr',
  },
  init: () => ({
    onRequest: (req, res) => {
      if (req.originalUrl.startsWith('/account') && !req.headers.cookie) {
        res.redirect('/login');
        return { shouldCancel: true };
      }
      return {};
    },
  }),
});
```

The cookie check above only illustrates where an auth redirect belongs; use your application's session validation. `onRequest` runs before the policy, including for crawlers. Add public URL patterns as you verify their HTML, metadata, data loading and browser behavior. Later, use `exclude` for the remaining SPA pages or remove the option to SSR every URL.

Keep the default `bots: 'ssr'` so detected crawlers receive SSR even on URLs served as SPA to people. Those routes must still support server execution and enforce authentication. Existing `onlyClient` components keep their browser-only behavior; this option does not make them server-renderable. Bot detection uses the `isbot` user-agent matcher. To wait for all suspended HTML, keep your existing bot-aware `onRouterReady` streaming decision.

## Roll back without rebuilding

Restart the same server build with a changed environment variable:

```bash
SSR_BOOST_SSR_ROUTES='!/details' npm run start:ssr
```

This serves `/details` as SPA to people while keeping other URLs on SSR. Googlebot still receives SSR for `/details`. No rebuild or separate browser bundle is needed. Apply the variable to every server process and restart them; changing `process.env` after creating the entry/handler does not change its policy. Set the variable in the process environment before startup, rather than in a client-side `VITE_*` variable.

`SSR_BOOST_SSR_ROUTES` replaces the configured `mode`, `routes` **and `decide`**, preserving `bots`. It accepts comma-separated path patterns, trims whitespace and ignores empty items:

| Value | Result for people |
| --- | --- |
| `/,/articles/:slug` | SSR only for the listed URLs |
| `!/details,!/account{/*rest}` | SPA for these patterns; SSR elsewhere |
| `/,/articles/:slug,!/articles/draft` | Include the public URLs, with exclusions winning |
| Empty string | SSR for all URLs; disable the configured `decide` |

Unset the variable and restart to restore the application configuration. Environment values use string patterns, not JavaScript regular expression literals. Malformed patterns fail during entry/handler creation instead of silently changing the rollout.

To keep an existing include rollout while rolling back one URL, repeat its include list and add the exclusion, for example `SSR_BOOST_SSR_ROUTES='/,/articles/:slug,!/articles/draft'`. This keeps unlisted URLs on SPA. A value containing only exclusions selects SSR for every other URL.

Active policies default document responses to `Cache-Control: no-store`, so cached SSR/SPA documents do not obscure a rollback. If `onRequest` supplies a cache policy, it takes precedence: configure your CDN's cache keys and invalidation to account for bot and request-specific decisions before enabling document caching. Static asset caching is unchanged. [Document header rules](/guide/caching#documentheaders-rules-options) apply to SPA shells as well as SSR documents, including the private default for requests carrying the session cookie.

## Configuration reference

Pass `ssr` in the third argument of the [managed Express entry](/api/server-entry#ssr), or in the options argument of Fetch [`createHandler`](/guide/runtime-adapters#create-a-fetch-handler):

```ts
interface ISsrPolicy {
  mode?: 'all' | 'include' | 'exclude';
  routes?: (string | RegExp)[];
  bots?: 'ssr' | 'policy';
  decide?: (params: {
    request: Request;
    url: URL;
    isBot: boolean;
  }) => 'ssr' | 'spa' | undefined;
}
```

| Option | Default | Behavior |
| --- | --- | --- |
| `mode` | `'all'` | `all` renders every URL; `include` renders only matching URLs; `exclude` serves matching URLs as SPA. |
| `routes` | `[]` | String or RegExp patterns matched against `url.pathname`, including any router basename. An empty include list makes every URL SPA; an empty exclude list makes every URL SSR. `all` ignores the list. |
| `bots` | `'ssr'` | Detected crawlers always receive SSR, ahead of `decide` and the environment override. `'policy'` makes them follow the same decisions as other requests. |
| `decide` | — | Synchronously override the configured mode for one request; return `undefined` to use the route policy. Receives the original Fetch Request, parsed URL and detected bot flag. |

String patterns use path-to-regexp 8 syntax: `/articles/:slug` for one segment, `/account/*rest` for one or more segments, and `/account{/*rest}` for the account root and all descendants. Optional parts use braces, such as `/articles{/:slug}`. String matching covers the entire pathname, is case-insensitive and permits a trailing slash. Query strings are ignored by patterns and remain available to `decide`. Use a RegExp when you need different matching rules, for example `/^\/internal(?:\/|$)/`; repeated requests do not share its mutable `lastIndex`.

For a request-dependent switch:

```ts
ssr: {
  mode: 'include',
  routes: ['/', '/articles/:slug'],
  decide: ({ url }) => url.searchParams.get('render') === 'spa' ? 'spa' : undefined,
},
```

Fetch handlers use the same option:

```ts
const handle = createHandler(
  { handler: createStaticHandler(routes), createApp, renderToStream },
  {
    getHtml,
    prepare: createRouteAssetPreparer({ buildDir: './build' }),
    ssr: { mode: 'exclude', routes: ['/details'] },
    onRequest: ({ request }) => initializeRequest(request),
  },
);
```

`getHtml` supplies the existing document shell. On Node, [`loadHtmlShell`](/api/node-production) reads it once; on edge runtimes, supply an in-memory shell and your normal asset `prepare` hook. For a router mounted at `/app`, pass `basename: '/app'` to both `createStaticHandler` and `createHandler`, and write policy patterns such as `/app/details`. Managed Express takes the basename from `routerOptions`.

## What happens on SPA URLs

The server runs `onRequest`, selects the policy, matches route structure without importing lazy server modules or running loaders/actions, and injects the matched route's CSS and module preloads. Fetch `prepare` hooks receive `context.matches` and `context.isSpa`; `routerContext` is absent on SPA responses. The managed server prepares Vite assets automatically.

The response is the empty application shell with status 200, `Content-Type: text/html; charset=utf-8`, and `data-force-spa="1"`. It uses the same shell generation as `spaIndex`; enabling an extra `index-spa.html` build artifact is optional. Production file contents and generated shells are cached in memory per process. Each request gets a fresh mutable shell for asset injection; development template changes invalidate generation. Fetch `getHtml` still runs per request, so request-specific shells are not reused for a different request.

SPA documents contain no router hydration data or `getState` snapshots. SSR render hooks (`onRouterReady`, `onShellReady`, `onResponse`, `getState`, and render error hooks) do not run for them. Keep authentication and HTTP redirects in `onRequest`. An Express hook can send a response and return `shouldCancel`; a Fetch hook can return a Response. HEAD returns the same metadata without a body.

The browser entry mounts with `createRoot` and reports `isSSRMode: false` to its `init` hook. Loaders and loader redirects execute in the browser, as they already do during client navigation. Keep those loaders browser-compatible and use APIs for server-only work. A loader redirect on an initial SPA URL changes the client route after the 200 shell; it is not an HTTP redirect. Unknown SPA URLs also return the 200 shell and let the browser router render its fallback. Direct non-JavaScript form submissions to SPA-selected URLs do not run server actions.

Links and router navigation between SSR and SPA routes use the shared browser router without reloading the document. Reloading a SPA URL mounts again; a direct link to an SSR URL still passes cookies through the Fetch request to its loaders.

SPA routes render no application content server-side. Crawlers see only the shell when they follow the SPA policy, including with `bots: 'policy'`; the default bot override keeps detected crawlers on SSR. Check [policy diagnostics](/reference/diagnostics#ssr_boost_ssr_policy) during development for the chosen policy and misspelled patterns.
