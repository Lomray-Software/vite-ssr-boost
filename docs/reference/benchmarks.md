# Benchmarks

[Lomray-Software/ssr-benchmarks](https://github.com/Lomray-Software/ssr-benchmarks) runs the same three-route React application on vite-ssr-boost, React Router Framework mode, Vike, TanStack Start and Next.js. The routes cover static content with a counter, a list with delayed data, and a detail page with an immediate field and a deferred field. Shared content, styling and deterministic data keep the workload comparable; each implementation uses its framework's routing and rendering conventions.

See the [repository README for current tables and methodology](https://github.com/Lomray-Software/ssr-benchmarks#results). The measurements describe that workload, not a general framework ranking. Lomray maintains both the benchmark and vite-ssr-boost.

## What is measured

- **Cold start:** fresh production process startup through its first completed successful response, including the npm launcher and first request. This does not measure serverless provisioning or an empty OS cache.
- **RSS:** resident memory in the serving Node process after HTTP load, before browser measurements; not peak memory or the Chromium process.
- **Emitted JavaScript:** all production JS and the client-output subset, excluding source maps and build caches. Emitted server code is not browser download cost.
- **Fetched JavaScript:** actual external JavaScript fetched by a fresh browser for each route, plus inline executable scripts, reported with normalized gzip estimates. This includes hydration/bootstrap payloads.
- **TTFB percentiles:** p50, p95 and p99 for each route under the documented warmup and request load. Raw results also contain full-response timings and response bytes.
- **Browser milestones:** time to a counter that responds to a click and time until the deferred field is visible. These are application-specific observations, not a general Web Vitals score.

Raw results include samples, settings, source/lockfile hashes, runtime versions and machine details. Compare complete runs on the same machine and mode; quick runs only check the harness.

## Runtimes

The repository's [Runtimes section](https://github.com/Lomray-Software/ssr-benchmarks#runtimes) serves the same built boost application through seven servers: the managed Express server (`ssr-boost start`), the Fetch core on `node:http`, Fastify, Hono on Node, Hono on Bun, Elysia on Bun and `Bun.serve`. Every variant shares one Fetch handler and one static-file policy, and a parity check proves the HTML, static files, cache validators and status codes are identical before anything is measured.

Per variant, and separately for identity and gzip responses, it records TTFB and full-response percentiles at 10 connections, requests per second with the p99 at 50 and 100 connections, cold start, RSS after the load and after 10,000 further requests (a leak indicator), and CPU per completed request sampled inside the server process. The methodology names which variants compress and how; workerd and Deno are not in the table because they need a different bundle and accounting environment.

Use it to choose a transport for an existing boost application: the managed server is the convenient default, the Fetch adapters remove its overhead, and the Bun variants trade the managed CLI for the highest throughput and lowest memory in that workload.

## Regenerate or reproduce

The repository's [weekly GitHub Actions workflow](https://github.com/Lomray-Software/ssr-benchmarks/blob/prod/.github/workflows/bench.yml) runs the pinned applications, uploads results, and commits successful full `results/` output and regenerated README tables. It also supports manual dispatch. Failed or incomplete runs are not published as successful results; dependency updates require an app/lockfile change.

Clone the benchmark repository and, from its root, run:

```sh
npm ci && npm run bench
```

Follow the [README prerequisites](https://github.com/Lomray-Software/ssr-benchmarks#reproduce) for Node, Chromium and Linux browser libraries. The runner builds and measures each app separately. Use its documented output option to keep an independent run without replacing the default results.

## Challenge a number

Open a [pull request in ssr-benchmarks](https://github.com/Lomray-Software/ssr-benchmarks/pulls) with the app diff that reproduces or corrects the concern. Preserve the [shared application contract](https://github.com/Lomray-Software/ssr-benchmarks/blob/prod/SPEC.md), include the exact command, raw JSON and environment, and provide before/after results from the same machine. Disclose changed defaults. Framework maintainers can propose a more idiomatic implementation through the same process.
