# Acceptance gates

| Gate | Status | Proof |
| --- | --- | --- |
| Adversarial Express contract | Passing | Cookies, real 103, split UTF-8, disconnect abort, backpressure, final chunk, timeout, shell/recoverable/transport errors |
| Adapter conformance | Passing | The same React SSR suite runs on Node, Express, Fastify, Hono, and edge Fetch |
| Edge runtime | Passing | A bundled app boots and streams inside Miniflare/workerd |
| Optional dependency boundary | Passing | The packed library installs with `--omit=optional`; core and edge execute without Express or compression |
| Template development and build | Passing | Unchanged `vite-template@prod` runs in dev, reloads an SSR module, builds, boots production, serves static assets, checks TTFB against the released version, and passes streamed/buffered route checks |
