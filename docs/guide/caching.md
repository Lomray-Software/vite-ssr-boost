# Document headers and caching

Cache guest HTML at the CDN with a short freshness lifetime and a bounded
stale-while-revalidate window. Bypass **both cache reads and writes** whenever the
session cookie or Authorization header is present. Authenticated documents use
`private, no-store`; cache their underlying data with appropriate user or tenant keys
instead of sharing rendered pages.

Only opt URLs into a shared cache when their HTML, loader data and serialized custom
state are public and independent of unkeyed inputs. Put locale or other public variants
in the URL, or design a separate cache key. Login, account, cart and mutation routes
should bypass the page cache. Purge guest entries when content must disappear sooner
than their freshness plus stale window.

`private` excludes shared caches; `no-store` also excludes browser storage. Setting
Set-Cookie alone does not prohibit caching, so the document helper applies a privacy
default explicitly. See [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html).
Stale-while-revalidate permits a bounded stale response while refresh runs in the
background; it does not extend freshness. See [RFC 5861](https://www.rfc-editor.org/rfc/rfc5861.html).

## HTTP helpers

Import the server-side `@lomray/vite-ssr-boost/http` entry. It uses Fetch primitives,
has no Node-only imports, and works with either renderer. Keep it out of browser entries.
All snippets on this page are compiled fixtures; the helper, Express, Worker and
Nginx examples also have executable tests.

### `cacheControl(policy)`

The boolean fields are `public`, `private`, `noStore`, `noCache`, `mustRevalidate`,
and `immutable`. The duration fields are `maxAge`, `sMaxAge`, `staleWhileRevalidate`,
and `staleIfError`, in non-negative safe integer seconds. False and undefined fields
are omitted; an empty object returns an empty string. Invalid types, unknown fields,
public plus private, and contradictory storage/revalidation directives throw TypeError.

These policies and ordered rules are shared by the following examples:

<<< ../../__fixtures__/caching/policy.ts

The SWR policy uses `max-age`, not `s-maxage`: RFC 9111 gives `s-maxage` the
semantics of proxy-revalidate, which prevents shared caches from serving stale
responses before validation. The `sharedPolicy` alternative gives browsers a zero
freshness lifetime and shared caches 30 seconds when stale serving is unnecessary.
The builder permits `sMaxAge` together with stale extensions, but does not change
the cache's interpretation. Cloudflare documents this restriction in its
[revalidation guide](https://developers.cloudflare.com/cache/concepts/revalidation/).

### `documentHeaders(rules, options?)`

The helper returns a function taking the Fetch render context and returning a fresh
Headers object. Each rule has `when({ request, url, isBot, hasCookie, routerContext })`
and `set: HeadersInit`. All matching rules run in array order. Later rules replace
ordinary fields; every Set-Cookie value appends independently. Existing hook headers
are the starting point. Guests without a matching policy keep those headers.

`isBot` is a User-Agent heuristic matching bot, crawler, spider or crawling; it is
not an authentication check. `hasCookie(name)` compares exact, case-sensitive cookie
names and treats empty values as present, without decoding the values.

Set `sessionCookie` to your application's cookie name. After the rules, Set-Cookie
on the resulting document, Authorization on the request, or that session cookie
forces `private, no-store`. Configure the same cookie name at the CDN. A deliberate
`protectPrivate: false` override disables this final protection; public responses
with Set-Cookie or the configured session cookie then trigger the development
[SSR_BOOST_CACHE_PRIVATE_LEAK diagnostic](/reference/diagnostics#ssr_boost_cache_private_leak).

The helper removes the Cookie token from Vary, preserving other tokens. **It never
emits Vary: Cookie**: varying on entire cookie strings fragments a CDN cache by
session IDs and unrelated tracking cookies. Use a session-presence bypass instead.
Do not use these URL-only recipes for pages personalized by other cookies; bypass
those pages too. Removing Vary does not make personalized content public.

Use the handler's `documentHeaders` option to apply the rules automatically after
`onShellReady` in `prepareHtmlResponse`, before document metadata is committed.
It is opt-in, including an empty rule list to enable only the privacy defaults.
Explicit loader/action and server redirects keep their existing `mergeResponseHeaders`
precedence; short-circuit `onRequest` responses and fatal shell errors are not rule
targets. Give those responses their own cache headers.

For manual use in `onRouterReady` or `onShellReady`:

<<< ../../__fixtures__/caching/manual.ts

The shell stage sees cookies written by earlier hooks. If you use the router stage,
recompute after any later header changes. Headers and statuses cannot change once
the streamed shell has been sent.

### `copyLoaderHeaders(routerContext, { allow })`

Rendered loader/action headers remain separate from document headers until explicitly
copied. This helper returns a new Headers object containing only the allowlist. It
visits matched routes from root to leaf, loader before action at the same route.
The first ordinary value wins, so the shallowest route controls Cache-Control and
other allowed fields. All Set-Cookie values append in traversal order, including
cookies with commas in Expires. Unmatched route headers are ignored. Content-Type
is never copied, even when allowed: loader JSON is not the HTML document.

The complete application factory below demonstrates copying without discarding
existing hook headers. Document rules run afterwards and override copied ordinary
fields. Supply the Node or edge renderer as shown in the recipes. This example renders
server HTML only; an interactive application supplies its built browser script and
static assets through its existing shell/asset pipeline. The cookie check is a
demonstration of presence, not session validation.

<<< ../../__fixtures__/caching/app.tsx

The managed CLI entry passes the same policy options through its `init` result:

<<< ../../__fixtures__/caching/managed.tsx

## Cloudflare Worker

This Worker caches `/guest` by the full URL, including the query string. Credentialed
requests bypass lookup and storage. Guest renders receive only the URL and a fixed
Accept header, so unkeyed cookies or headers cannot affect the shared representation.
HEAD, mutations, ranges, validators and explicit request cache directives go to the origin.
Only successful responses with the exact guest policy, no cookies and no Vary are stored.

The [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) does not
implement stale-while-revalidate. This wrapper stores the body for 90 seconds, returns
the original 30-second policy and Age to clients, and refreshes during the next 60
seconds with `waitUntil`. At expiry it waits for a fresh response. Refresh errors
cannot extend the stale window. Concurrent refreshes are coalesced within one isolate.
Cache API storage is local to a data center and does not use tiered caching.

<<< ../../__fixtures__/caching/guest-cache.ts

Worker entry (bundle with the `workerd` and `worker` resolution conditions):

<<< ../../__fixtures__/caching/worker.ts

### Equivalent Cache Rules for an origin server

Use these settings instead of the Worker wrapper when Cloudflare fronts the Express
origin directly. The origin must keep the same public representation contract.
Create the guest eligibility rule first and the bypass rule last, since matching
later rules override earlier settings. Scope both rules to your hostname.

| Rule | Matching requests | Settings |
| --- | --- | --- |
| Guest page | GET or HEAD, path exactly `/guest` | Eligible for cache; respect origin Cache-Control and bypass if absent; browser TTL respects origin; full URL key including query; serve stale while revalidating enabled |
| Credentials | Cookie string contains `session=` or Authorization header is present | Bypass cache |
| Other requests | Other paths, methods, Range, conditional headers or explicit request cache directives | Bypass cache |

The cookie substring match intentionally over-bypasses lookalike names; it does not
miss an empty `session=` value. Use the rules editor's header-presence condition for
Authorization, including empty values. Do not override origin private/no-store,
strip Set-Cookie, or force an edge TTL on credentialed responses. The origin guest
policy supplies max-age and stale-while-revalidate; using s-maxage disables stale
serving on Cloudflare. See [Cache Rules settings](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/)
and [cookie bypass](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/).

## Express behind Nginx

Create the Express app with the Node renderer:

<<< ../../__fixtures__/caching/express.ts

Run this launcher with your server TypeScript build/runtime:

<<< ../../__fixtures__/caching/express-start.ts

Run Nginx with this configuration in a writable prefix directory. It listens on 8080
and proxies to Express on localhost:3000; configure production TLS and hostnames for
your deployment. Guest HTML is buffered into the proxy cache. The private path
always reaches Express. Both bypass and no-cache directives matter: the former
prevents reading a guest hit; the latter prevents storing a private response.

<<< ../../__fixtures__/caching/nginx.conf{nginx}

`$cookie_session` alone treats empty and `0` values as false, so the additional raw
cookie presence map covers those values. Nginx honors origin Cache-Control,
Set-Cookie and Vary by default. Background update uses the origin's bounded SWR
window; avoid an unconditional `proxy_cache_use_stale updating` override that could
outlive it. See the [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

## Conditional requests and streaming

`conditionalRequest(request, { etag?, lastModified? })` returns a bodyless 304 for a
matching GET or HEAD, otherwise undefined. ETags must be quoted (optionally W/);
Last-Modified accepts a Date or date string. It supports weak ETag comparison,
comma-separated tags and `*` for an existing representation. If-None-Match takes
precedence over If-Modified-Since, including when no ETag matches. Modification
times compare at HTTP's whole-second precision. Invalid supplied validators throw;
invalid request validators are ignored. Other methods never return 304.

Call it only for an existing successful representation after selecting and authorizing
that representation. It does not implement mutation preconditions such as If-Match.
Retain the 200 response's Cache-Control, Vary and Content-Location when applicable.
The following buffered response uses an application-supplied version covering both
article and template revisions:

<<< ../../__fixtures__/caching/buffered.ts

A streamed body cannot be hashed before sending it. Setting `isStream: false` waits
for React and loader promises, but the Fetch response still exposes a body stream;
buffer/consume that body yourself before hashing it and constructing a conditional
response. This helper never reads a stream. For streaming applications, use an
application-supplied representation version known before rendering, and make the
conditional decision in a buffered/non-streaming path before committing the shell.
The version must cover every output dependency, including serialized state and
personalization. A build ID alone is insufficient for changing page data.
