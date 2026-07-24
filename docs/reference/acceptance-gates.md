# Acceptance gates

| Gate | Status | Proof |
| --- | --- | --- |
| Adversarial Express contract | Passing | Cookies, real 103, split UTF-8, disconnect abort, backpressure, final chunk, timeout, shell/recoverable/transport errors |
| Adapter conformance | Passing | The same React SSR suite runs on Node, Express, Fastify, Hono, and edge Fetch |
| Edge runtime | Passing | The same bundled app boots from source and built package output inside Miniflare/workerd |
| Optional dependency boundary | Passing | The packed library installs with `--omit=optional`; core and edge execute without Express or compression |
| Adapter compression | Passing | Node sends gzip on the wire; workerd runs `CompressionStream`; the core imports neither Express nor compression |
| Template development and build | Passing | Unchanged `vite-template@fbbd655` runs in dev, reloads an SSR module, builds, boots production, serves static assets, checks TTFB against the released version, and passes streamed/buffered route checks |

The template checkout is pinned to commit `fbbd65524ceb95764bebc39da67af7d9c5737f80`.
