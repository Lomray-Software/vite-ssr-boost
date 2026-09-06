import { execFileSync, spawn } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createGunzip, gzipSync } from 'node:zlib';
import { stripVTControlCharacters } from 'node:util';
import { parse } from '@babel/parser';
import { createProductionMemoryProbe, configureProductionMeasurements, startProductionMeasurement, measureProductionColdStart, assertProductionBudgets } from './helpers/production-budget.mjs';

// KB = 1024 bytes. For intentional growth, measure the pinned template again and
// set this to Math.ceil(measured gzip KB * 1.05); document the reason and new size.
const TEMPLATE_CLIENT_GZIP_BUDGET_KB = 154;
const TEMPLATE_HOME_MARKER = 'SPA, SSR, Mobx, Consistent Suspense, Meta tags';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const projectRoot = process.cwd();
const source = resolve(process.argv[2] ?? join(projectRoot, '..', 'vite-template'));
const directory = await mkdtemp(join(tmpdir(), 'vite-ssr-boost-template-'));
const keepTemplate = process.env.SSR_BOOST_KEEP_TEMPLATE === '1';
const useCurrentDependencies = process.env.SSR_BOOST_TEMPLATE_CURRENT === '1';
const acceptance = {
  clientGzipKb: undefined,
  productionReadyMs: undefined,
  coldStart: undefined,
  baselineRss: undefined,
  candidateRss: undefined,
  baselineTtfb: undefined,
  candidateTtfb: undefined,
  baselineDeferredTtfb: undefined,
  candidateDeferredTtfb: undefined,
  chunks: [],
  deferred: [],
  policyInfo: 0,
  diagnosticsWarnings: 0,
};
const cli = join(directory, 'node_modules', '@lomray', 'vite-ssr-boost', 'cli.js');
const runtimePath = [
  join(directory, 'node_modules', '.bin'),
  dirname(process.execPath),
  process.env.PATH,
]
  .filter(Boolean)
  .join(':');

const getPort = async () => {
  const server = net.createServer();

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();

  server.close();
  await once(server, 'close');

  if (!address || typeof address === 'string') {
    throw new Error('Failed to reserve an acceptance port.');
  }

  return address.port;
};

const recordDiagnostics = (output) => {
  for (const [, code] of stripVTControlCharacters(output).matchAll(/\b(SSR_BOOST_[A-Z_]+)(?=:|\])/g)) {
    if (code === 'SSR_BOOST_SSR_POLICY') acceptance.policyInfo += 1;
    else acceptance.diagnosticsWarnings += 1;
  }
};

const start = (args, env = {}) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    env: { ...process.env, PATH: runtimePath, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
  child.closed = once(child, 'close').then((result) => {
    recordDiagnostics(output);
    return result;
  });
  return child;
};

const run = async (args) => {
  const [code] = await start(args).closed;

  if (code !== 0) {
    throw new Error(`ssr-boost ${args[0]} exited with code ${code}.`);
  }
};

const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;

const stop = async (child) => {
  if (hasExited(child)) {
    await child.closed;
    return;
  }

  const exited = once(child, 'exit');

  child.kill('SIGTERM');

  await Promise.race([
    exited,
    new Promise((resolveTimeout) => {
      setTimeout(resolveTimeout, 3_000);
    }),
  ]);

  if (!hasExited(child)) {
    const killed = once(child, 'exit');

    child.kill('SIGKILL');
    await killed;
  }
  await child.closed;
};

const waitUntilReady = async (origin, child) => {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (hasExited(child)) {
      throw new Error(
        `Server exited before becoming ready (${child.exitCode ?? child.signalCode}).`,
      );
    }

    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`Server responded with ${response.status}.`);

      return;
    } catch {
      await new Promise((resolveTimeout) => {
        setTimeout(resolveTimeout, 100);
      });
    }
  }

  throw new Error(`Server did not become ready: ${origin}`);
};

const inspectStream = (origin, pathname, headers = {}) =>
  new Promise((resolveStream, reject) => {
    const started = performance.now();
    const request = http.get(new URL(pathname, origin), { headers }, (response) => {
      const chunks = [];
      const chunkTimes = [];
      let firstChunkMs;
      // Count HTML bytes, not the empty gzip header that can hide buffering regressions.
      const decoded =
        response.headers['content-encoding'] === 'gzip' ? response.pipe(createGunzip()) : response;

      decoded.on('data', (chunk) => {
        firstChunkMs ??= performance.now() - started;
        chunks.push(chunk);
        chunkTimes.push(performance.now() - started);
      });
      decoded.on('end', () => {
        resolveStream({
          chunks: chunks.length,
          chunkHtml: chunks.map((chunk) => chunk.toString('utf8')),
          chunkTimes,
          firstChunkMs,
          html: Buffer.concat(chunks).toString('utf8'),
          status: response.statusCode,
          encoding: response.headers['content-encoding'],
          totalMs: performance.now() - started,
        });
      });
      response.on('error', reject);
      decoded.on('error', reject);
    });

    request.setTimeout(20_000, () => request.destroy(new Error('SSR stream timed out.')));
    request.on('error', reject);
  });

/** Compare warmed routes in alternating order with the same browser headers and socket policy. */
const measureTtfb = async (origin) => {
  const samples = { '/': [], '/deferred': [] };
  const headers = { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Encoding': 'identity' };

  for (let sample = -3; sample < 11; sample += 1) {
    const paths = sample % 2 === 0 ? ['/', '/deferred'] : ['/deferred', '/'];

    for (const pathname of paths) {
      const { status, firstChunkMs } = await inspectStream(origin, pathname, headers);

      assert.equal(status, 200, `TTFB ${pathname} status`);
      assert.ok(Number.isFinite(firstChunkMs), `TTFB ${pathname} must contain HTML`);

      if (sample >= 0) samples[pathname].push(firstChunkMs);
    }
  }

  /** Keep unrounded medians for the advisory latency comparison. */
  const median = (values) => values.sort((left, right) => left - right)[Math.floor(values.length / 2)];

  return { home: median(samples['/']), deferred: median(samples['/deferred']) };
};

const inspectEarlyStream = async (origin, pathname, mode, headers = {}) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await inspectStream(origin, pathname, headers);
    assert.equal(response.status, 200, `${mode} streamed status`);

    if (response.chunks > 1 && response.firstChunkMs < response.totalMs - 100) {
      return response;
    }

    if (attempt < 3) {
      console.warn(`${mode}: early HTML was not observed; retrying (${attempt}/3).`);
    }
  }

  assert.fail(`${mode}: no early HTML after three attempts`);
};

const verify = async (origin, mode, base = '') => {
  const cases = [
    ['/', 200],
    ['/not-lazy', 200],
    ['/redirect-demo', 301],
    ['/missing', 404],
    ['/vite.svg', 200],
  ];

  for (const [pathname, expectedStatus] of cases) {
    const response = await fetch(new URL(`${base}${pathname}`, origin), { redirect: 'manual' });

    assert.equal(response.status, expectedStatus, `${mode} ${pathname}`);
    await response.arrayBuffer();
  }

  const head = await fetch(`${origin}${base}/details`, { method: 'HEAD' });
  assert.equal(head.status, 200, `${mode} HEAD`);
  assert.equal(await head.text(), '', `${mode} HEAD has a body`);

  const eager = await fetch(`${origin}${base}/not-lazy`).then((response) => response.text());
  assert.match(eager, /Styled text/);
  assert.match(eager, /<style\b|rel="stylesheet"/, `${mode} eager route has no styles`);

  const assetUrls = [...eager.matchAll(/(?:src|href)="([^"]+\.(?:js|css|tsx?))"/g)].map(
    ([, url]) => new URL(url, origin),
  );
  assert.ok(assetUrls.length, `${mode} has no client assets`);
  for (const url of assetUrls) {
    const response = await fetch(url);
    assert.equal(response.status, 200, `${mode} asset ${url.pathname}`);
    assert.match(response.headers.get('content-type'), /javascript|text\/css/);
    await response.arrayBuffer();
  }

  const streamed = await inspectEarlyStream(origin, `${base}/details`, mode);

  assert.match(streamed.html, /window\.__staticRouterHydrationData/);
  assert.match(streamed.html, /<\/html>/);

  const buffered = await inspectStream(origin, `${base}/details`, { Cookie: 'isCrawler=1' });

  assert.equal(buffered.status, 200, `${mode} buffered status`);
  assert.match(buffered.html, /window\.__staticRouterHydrationData/);
  assert.match(buffered.html, /<\/html>/);
  // A fully rendered tree has no pending Suspense boundaries; compare content, not two clocks.
  assert.doesNotMatch(buffered.html, /<!--\$\?-->/, `${mode} crawler has pending content`);

  let gzipChunks;
  if (mode !== 'development') {
    const compressed = await inspectEarlyStream(origin, `${base}/details`, `${mode} gzip`, {
      'Accept-Encoding': 'gzip',
    });
    assert.equal(compressed.encoding, 'gzip');
    assert.match(compressed.html, /<\/html>/);
    gzipChunks = compressed.chunks;
    console.info(
      `${mode}: gzip HTML shell ${Math.round(compressed.firstChunkMs)}ms / complete ${Math.round(compressed.totalMs)}ms`,
    );
  }

  console.info(
    `${mode}: routes passed; streamed=${streamed.chunks} chunks (${Math.round(
      streamed.firstChunkMs,
    )}ms/${Math.round(streamed.totalMs)}ms); buffered=${buffered.chunks} chunks`,
  );
  acceptance.chunks.push({ mode, streamed: streamed.chunks, buffered: buffered.chunks, gzip: gzipChunks });
  await verifyDeferred(origin, mode, base);
  if (process.env.SSR_BOOST_TEMPLATE_BROWSER === '1') {
    execFileSync(process.execPath, [
      join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test', '--config', 'playwright.template.config.mjs',
    ], {
      cwd: projectRoot,
      env: { ...process.env, TEMPLATE_BROWSER_ORIGIN: `${origin}${base}/` },
      stdio: 'inherit',
    });
  }
};

const verifyDeferred = async (origin, mode, base) => {
  const browser = await inspectEarlyStream(origin, `${base}/deferred`, `${mode} deferred`, {
    'User-Agent': 'Mozilla/5.0',
  });
  const first = browser.chunkHtml[0];
  const later = browser.chunkHtml.slice(1).join('');
  const init = /window\.__ssrBoostStream[^<]*\.push\(\["init",/;
  const resolveFrame = /window\.__ssrBoostStream[^<]*\.push\(\["resolve",/;
  const users = ['Ada Lovelace', 'Grace Hopper', 'Margaret Hamilton'];

  assert.match(first, /<title>Deferred data<\/title>/, `${mode} deferred first-chunk title`);
  assert.match(first, init, `${mode} deferred first-chunk init frame`);
  assert.match(first, /SSRBPromise/, `${mode} deferred first-chunk promise placeholder`);
  assert.doesNotMatch(first, resolveFrame, `${mode} deferred resolved before the shell`);
  assert.match(later, resolveFrame, `${mode} deferred later resolve frame`);
  for (const user of users) {
    assert.ok(!first.includes(user), `${mode} deferred ${user} arrived in the first chunk`);
    assert.ok(later.includes(`<li>${user}</li>`), `${mode} deferred missing rendered ${user}`);
  }
  const resolveIndex = browser.chunkHtml.findIndex((chunk) => resolveFrame.test(chunk));
  assert.ok(resolveIndex > 0, `${mode} deferred resolve frame must arrive in a later chunk`);
  const settleMs = browser.chunkTimes[resolveIndex] - browser.firstChunkMs;
  assert.ok(settleMs > 100, `${mode} deferred resolve frame was buffered with the shell`);

  const bot = await inspectStream(origin, `${base}/deferred`, { 'User-Agent': 'Googlebot' });
  assert.equal(bot.status, 200, `${mode} deferred Googlebot status`);
  assert.match(bot.html, /<title>Deferred data<\/title>/);
  assert.doesNotMatch(bot.html, /<!--\$\?-->/, `${mode} deferred Googlebot pending boundaries`);
  for (const user of users) {
    assert.ok(bot.html.includes(`<li>${user}</li>`), `${mode} deferred Googlebot missing ${user}`);
  }
  acceptance.deferred.push({ mode, settleMs });
  console.info(`${mode}: deferred title + init first; resolve + 3 users later; settle ${Math.round(settleMs)}ms; Googlebot resolved, 0 pending boundaries`);
};

const measureClientGzip = async () => {
  const assets = join(directory, 'build', 'client', 'assets');
  const scripts = (await readdir(assets, { withFileTypes: true }))
    .filter((file) => file.isFile() && file.name.endsWith('.js'));
  assert.ok(scripts.length, 'Template production build has no client JavaScript assets.');
  const sizes = await Promise.all(scripts.map(async (file) =>
    gzipSync(await readFile(join(assets, file.name)), { level: 9 }).length));
  acceptance.clientGzipKb = sizes.reduce((total, bytes) => total + bytes, 0) / 1024;
  console.info(`template client gzip total: ${acceptance.clientGzipKb.toFixed(3)} KB / ${TEMPLATE_CLIENT_GZIP_BUDGET_KB} KB budget (${scripts.length} JS assets)`);
  assert.ok(acceptance.clientGzipKb <= TEMPLATE_CLIENT_GZIP_BUDGET_KB,
    `Template client gzip size exceeds ${TEMPLATE_CLIENT_GZIP_BUDGET_KB} KB budget.`);
};

const reportAcceptance = async () => {
  const milliseconds = (value) => value === undefined ? 'not measured' : `${value.toFixed(3)} ms`;

  /** Format resident memory independently of heap size. */
  const memory = (value) => value === undefined ? 'not measured' : `${(value / 1024 ** 2).toFixed(2)} MiB`;
  const markdown = [
    `## Template acceptance (${useCurrentDependencies ? 'current' : 'pinned'} runtime dependencies)`,
    '',
    '| Metric | Measured | Budget |',
    '| --- | ---: | ---: |',
    `| Template client gzip total (KB, 1024 bytes) | ${acceptance.clientGzipKb?.toFixed(3) ?? 'not measured'} | ${TEMPLATE_CLIENT_GZIP_BUDGET_KB} |`,
    `| Production server ready (process start to successful response) | ${milliseconds(acceptance.productionReadyMs)} | advisory |`,
    `| Plain production cold start (npm, median of 5) | ${milliseconds(acceptance.coldStart?.baselineMs)} | baseline |`,
    `| Production cold start (npm, median of 5) | ${milliseconds(acceptance.coldStart?.candidateMs)} | ≤ 2 × baseline |`,
    `| Plain server RSS after TTFB | ${memory(acceptance.baselineRss)} | baseline |`,
    `| Production server RSS after TTFB | ${memory(acceptance.candidateRss)} | ≤ 1.6 × baseline |`,
    `| Baseline median TTFB | ${milliseconds(acceptance.baselineTtfb)} | advisory |`,
    `| Candidate median TTFB | ${milliseconds(acceptance.candidateTtfb)} | advisory |`,
    `| Baseline /deferred median HTML TTFB | ${milliseconds(acceptance.baselineDeferredTtfb)} | advisory |`,
    `| Candidate /deferred median HTML TTFB | ${milliseconds(acceptance.candidateDeferredTtfb)} | advisory: <= 1.5 × candidate / |`,
    ...acceptance.chunks.map(({ mode, streamed, buffered, gzip }) =>
      `| ${mode} chunks (streamed / buffered / decoded gzip) | ${streamed} / ${buffered} / ${gzip ?? 'n/a'} | — |`),
    ...acceptance.deferred.map(({ mode, settleMs }) =>
      `| ${mode} deferred settle delay (first HTML to resolve frame) | ${milliseconds(settleMs)} | > 100 ms |`),
    `| SSR_BOOST_SSR_POLICY info lines | ${acceptance.policyInfo} | informational |`,
    `| Other SSR_BOOST_ diagnostics | ${acceptance.diagnosticsWarnings} | 0 |`,
    '',
  ].join('\n');
  console.info(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
};

const crawlModules = async (origin) => {
  const response = await fetch(origin, { signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, 'cold development HTML status');
  const html = await response.text();
  const queue = [];
  const seen = new Set();
  const enqueue = (specifier, importer = origin) => {
    if (!/^(?:https?:\/\/|\/|\.\.?\/)/.test(specifier)) return;
    const url = new URL(specifier, importer);
    if (url.origin !== origin || seen.has(url.href)) return;
    assert.ok(seen.size < 600, 'cold development crawl exceeded 600 modules');
    seen.add(url.href);
    queue.push(url.href);
  };

  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
    if (/^<script\b/i.test(tag) && attributes.type === 'module' && attributes.src) {
      enqueue(attributes.src);
    } else if (/^<link\b/i.test(tag) && attributes.rel === 'modulepreload' && attributes.href) {
      enqueue(attributes.href);
    }
  }
  assert.ok(queue.length, 'cold development HTML has no module entries');

  // Process each breadth before requesting dependencies discovered in it.
  for (let index = 0; index < queue.length; index += 1) {
    const url = queue[index];
    let module = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    // An optimizer reload can invalidate URLs already queued by the first response.
    // Keep crawling for diagnostics; the caller still rejects the reload log.
    if (module.status === 504 && new URL(url).searchParams.has('v')) {
      await module.arrayBuffer();
      const current = new URL(url);
      current.searchParams.delete('v');
      module = await fetch(current, { signal: AbortSignal.timeout(20_000) });
    }
    assert.equal(module.status, 200, `cold development module ${url}`);
    assert.match(
      module.headers.get('content-type') ?? '',
      /javascript/,
      `cold development module type ${url}`,
    );
    const nodes = [
      parse(await module.text(), { sourceType: 'module', createImportExpressions: true }),
    ];
    while (nodes.length) {
      const node = nodes.pop();
      if (!node || typeof node !== 'object') continue;
      if (
        [
          'ImportDeclaration',
          'ExportNamedDeclaration',
          'ExportAllDeclaration',
          'ImportExpression',
        ].includes(node.type) &&
        node.source?.type === 'StringLiteral'
      ) {
        enqueue(node.source.value, url);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) nodes.push(...value);
        else if (value && typeof value === 'object' && 'type' in value) nodes.push(value);
      }
    }
  }
  console.info(`development cold start: crawled ${seen.size} modules`);
};

const verifyColdStart = async () => {
  await rm(join(directory, 'node_modules', '.vite'), { force: true, recursive: true });

  const port = await getPort();
  await writeFile(join(directory, '.env.development.local'), `VITE_PORT=${port}\n`);
  const child = spawn(process.execPath, [cli, 'dev', '--port', String(port)], {
    cwd: directory,
    env: { ...process.env, PATH: runtimePath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let output = '';
  const capture = (chunk) => {
    output += chunk;
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitUntilReady(origin, child);
    await crawlModules(origin);
    await new Promise((resolveTimeout) => {
      setTimeout(resolveTimeout, 5_000);
    });
    assert.ok(!hasExited(child), 'Cold development server exited during the crawl.');
  } finally {
    await stop(child);
    await closed;
    output = stripVTControlCharacters(output);
    console.info(output);
    recordDiagnostics(output);
  }

  assert.doesNotMatch(
    output,
    /new dependencies optimized|optimized dependencies changed|\bdependenc(?:y|ies) optimized:/,
    'Cold development discovered dependencies after startup.',
  );
  console.info('development cold start: no late dependency optimization or reload');
};

const verifySpa = async (origin) => {
  for (const pathname of ['/', '/details', '/missing']) {
    const response = await fetch(`${origin}${pathname}`);
    const html = await response.text();
    assert.equal(response.status, 200, `SPA ${pathname}`);
    assert.match(html, /id="root"/);
    assert.doesNotMatch(html, /window\.__staticRouterHydrationData/);
    assert.ok(!html.includes(TEMPLATE_HOME_MARKER), `SPA ${pathname} contains server-rendered content`);
    const entry = html.match(/<script[^>]+src="([^"]+)"/);
    assert.ok(entry, `SPA ${pathname} has no client entry`);
    const script = await fetch(new URL(entry[1], origin));
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    await script.arrayBuffer();
  }
  console.info('SPA: root, deep links, fallback and client assets passed');
};

const verifyIncremental = async (origin, mode) => {
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const details = await fetch(`${origin}/details`, { headers: { 'User-Agent': userAgent } });
  const shell = await details.text();
  assert.equal(details.status, 200, `${mode} SPA /details`);
  assert.match(details.headers.get('content-type'), /text\/html/);
  assert.equal(details.headers.get('cache-control'), 'no-store');
  assert.match(shell, /data-force-spa="1"/);
  assert.doesNotMatch(shell, /__staticRouterHydrationData|Welcome to demo app/);
  assert.match(shell, /rel="modulepreload"/, `${mode} SPA route chunk preload`);
  assert.match(shell, /<style\b|rel="stylesheet"/, `${mode} SPA styles`);
  for (const [, asset] of shell.matchAll(/(?:src|href)="([^"]+\.(?:js|css|tsx?))"/g)) {
    const response = await fetch(new URL(asset, origin));
    assert.equal(response.status, 200, `${mode} SPA asset ${asset}`);
    await response.arrayBuffer();
  }
  const home = await fetch(origin, { headers: { 'User-Agent': userAgent } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /window\.__staticRouterHydrationData/);
  const bot = await fetch(`${origin}/details`, { headers: { 'User-Agent': 'Googlebot' } });
  assert.equal(bot.status, 200);
  const botHtml = await bot.text();
  assert.match(botHtml, /window\.__staticRouterHydrationData/);
  assert.doesNotMatch(botHtml, /data-force-spa="1"/);
  const head = await fetch(`${origin}/details`, { method: 'HEAD', headers: { 'User-Agent': userAgent } });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  console.info(`${mode} incremental SSR: /details SPA shell + assets, / SSR, Googlebot /details SSR, HEAD passed`);
};


/**
 * Prove the packed server can respond without loading source configuration or tooling.
 */
const verifyProductionImports = async () => {
  const filename = join(directory, 'vite.config.ts');
  const original = await readFile(filename, 'utf8');
  const port = await getPort();
  const hook = join(projectRoot, 'scripts/helpers/production-imports.mjs');
  const relocated = join(directory, 'relocated-output');

  await writeFile(filename, "throw new Error('Production must not evaluate vite.config.ts');\n");
  await rename(join(directory, 'build'), relocated);
  const server = start(['start', '--port', String(port), '--build-dir', relocated, '--module-preload', '--host', '--focus-only', 'app'], {
    NODE_ENV: 'production',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${JSON.stringify(hook)}`,
  });

  try {
    const origin = `http://127.0.0.1:${port}`;

    await waitUntilReady(origin, server);
    const response = await fetch(`${origin}/deferred`);

    assert.equal(response.status, 200);
    await response.arrayBuffer();
    console.info('production imports: relocated build + start flags passed; no Vite, CLI command tree, Babel, config evaluation or source-path helpers');
  } finally {
    await stop(server);
    await writeFile(filename, original);
    await rename(relocated, join(directory, 'build'));
  }
};

/**
 * Preserve the actionable error for an application that has never been built.
 */
const verifyMissingBuild = async () => {
  const empty = await mkdtemp(join(tmpdir(), 'ssr-boost-no-build-'));

  try {
    let result;

    try {
      execFileSync(process.execPath, [cli, 'start'], { cwd: empty, env: process.env, timeout: 10_000, encoding: 'utf8' });
      assert.fail('Production started without a build.');
    } catch (error) {
      result = error;
    }

    assert.equal(result.status, 1);
    assert.match(stripVTControlCharacters(String(result.stderr)), /Before starting the server, you need to create a build: ssr-boost build or provide path to build dir: ssr-boost start --build-dir build/);
    console.info('production missing build: existing error preserved');
  } finally {
    await rm(empty, { force: true, recursive: true });
  }
};

const verifyIncrementalServer = async (command) => {
  const port = await getPort();
  if (command === 'dev') await writeFile(join(directory, '.env.development.local'), `VITE_PORT=${port}\n`);
  const server = start([command, '--port', String(port)], {
    SSR_BOOST_SSR_ROUTES: '!/details',
    SSR_BOOST_DIAGNOSTICS: '1',
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await waitUntilReady(origin, server);
    await verifyIncremental(origin, command === 'dev' ? 'development' : 'production');
  } finally {
    await stop(server);
  }
};

// Install the publishable package with its dependencies after measuring the original baseline.
const installCandidate = async () => {
  execFileSync('npm', [
    'pack', join(projectRoot, 'lib'), '--ignore-scripts', '--pack-destination', directory,
  ], { cwd: projectRoot, stdio: 'ignore', env: { ...process.env, HUSKY: '0' } });
  const archives = (await readdir(directory)).filter((filename) => filename.endsWith('.tgz'));

  assert.equal(archives.length, 1, 'npm pack must produce exactly one archive.');

  const packages = [join(directory, archives[0])];
  const dependencyRoot = useCurrentDependencies ? projectRoot : directory;

  for (const name of [
    'vite', 'react', 'react-dom', 'react-router',
    '@babel/generator', '@babel/parser', '@babel/traverse', '@babel/types',
  ]) {
    const metadata = JSON.parse(await readFile(join(dependencyRoot, 'node_modules', name, 'package.json'), 'utf8'));

    packages.push(`${name}@${metadata.version}`);
  }

  if (useCurrentDependencies) {
    packages.push('vite-plugin-devtools-json@1.1.0');
  }

  execFileSync('npm', ['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', ...packages], {
    cwd: directory,
    env: { ...process.env, PATH: runtimePath },
    stdio: 'inherit',
  });
  console.info(`Template runtime dependencies: ${packages.slice(1).join(', ')}`);
};

const configureBasename = async () => {
  const edit = async (relative, from, to) => {
    const filename = join(directory, relative);
    const sourceText = await readFile(filename, 'utf8');
    assert.ok(sourceText.includes(from), `Cannot configure basename in ${relative}`);
    await writeFile(filename, sourceText.replace(from, to));
  };
  await edit('vite.config.ts', "root: 'src',", "root: 'src', base: '/acceptance/',");
  await edit(
    'src/client.ts',
    // Insert at the entry options, independently of the init callback's parameters.
    'entryClient(App, routes, {',
    "entryClient(App, routes, { routerOptions: { basename: '/acceptance' },",
  );
  await edit(
    'src/server.ts',
    'abortDelay: 20000,',
    "abortDelay: 20000, routerOptions: { basename: '/acceptance' },",
  );
};

const configureTypedRoutes = async () => {
  const filename = join(directory, 'src', 'routes', 'index.ts');
  const original = await readFile(filename, 'utf8');
  const declaration = 'const routes: TRouteObject[] = [';
  const declarationIndex = original.indexOf(declaration);
  const arrayEnd = original.lastIndexOf('];');

  assert.match(original, /import type \{ TRouteObject \} from '@lomray\/vite-ssr-boost\/interfaces\/route-object'/);
  assert.ok(declarationIndex !== -1, 'Template routes declaration changed.');
  assert.ok(arrayEnd > declarationIndex, 'Template routes array terminator must follow its declaration.');
  const typedRoutes = `${original.slice(0, arrayEnd)}] satisfies TRouteObject[];${original.slice(arrayEnd + 2)}`;
  await writeFile(filename, typedRoutes.replace(declaration, 'const routes = ['));
  console.info('Template routes: satisfies TRouteObject[] enabled for candidate acceptance');
};

const verifyHmr = async (origin) => {
  const filename = join(directory, 'src', 'pages', 'home', 'index.tsx');
  const original = await readFile(filename, 'utf8');
  const current = TEMPLATE_HOME_MARKER;
  const marker = 'SSR dev reload accepted';

  assert.ok(original.includes(current), 'Template HMR marker source changed.');

  try {
    await writeFile(filename, original.replace(current, marker));

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const html = await fetch(origin, {
        headers: { 'Cache-Control': 'no-cache' },
      }).then((response) => response.text());

      if (html.includes(marker)) {
        console.info('development: SSR module reload passed');

        return;
      }

      await new Promise((resolveTimeout) => {
        setTimeout(resolveTimeout, 100);
      });
    }

    throw new Error('Development SSR module reload timed out.');
  } finally {
    await writeFile(filename, original);
  }
};

try {
  const tracked = execFileSync('git', ['-C', source, 'ls-files', '-z']).toString().split('\0');

  for (const filename of tracked.filter(Boolean)) {
    const destination = join(directory, filename);

    await mkdir(dirname(destination), { recursive: true });
    await cp(join(source, filename), destination, { recursive: true });
  }

  await cp(join(source, 'node_modules'), join(directory, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  await configureProductionMeasurements(directory);

  await run(['build']);

  const baselinePort = await getPort();
  const baseline = start(['start', '--port', String(baselinePort)]);
  let baselineTtfb;

  try {
    const origin = `http://127.0.0.1:${baselinePort}`;

    await waitUntilReady(origin, baseline);
    baselineTtfb = await measureTtfb(origin);
    acceptance.baselineTtfb = baselineTtfb.home;
    acceptance.baselineDeferredTtfb = baselineTtfb.deferred;
    console.info(`baseline production median HTML TTFB: / ${baselineTtfb.home.toFixed(3)}ms; /deferred ${baselineTtfb.deferred.toFixed(3)}ms`);
  } finally {
    await stop(baseline);
  }

  await installCandidate();
  await configureTypedRoutes();
  await verifyMissingBuild();

  const devPort = await getPort();

  await writeFile(join(directory, '.env.development.local'), `VITE_PORT=${devPort}\n`);

  const dev = start(['dev', '--port', String(devPort)]);

  try {
    const origin = `http://127.0.0.1:${devPort}`;

    await waitUntilReady(origin, dev);
    await verify(origin, 'development');
    await verifyHmr(origin);
  } finally {
    await stop(dev);
  }

  await verifyColdStart();
  await verifyIncrementalServer('dev');

  await run(['build']);
  await measureClientGzip();

  const prodPort = await getPort();
  const { environment: memoryEnvironment, memory, dispose } = await createProductionMemoryProbe(prodPort);
  const prodStarted = performance.now();
  const prod = start(['start', '--port', String(prodPort)], { ...memoryEnvironment, NODE_ENV: 'production' });

  try {
    const origin = `http://127.0.0.1:${prodPort}`;

    await waitUntilReady(origin, prod);
    acceptance.productionReadyMs = performance.now() - prodStarted;
    await verify(origin, 'production');

    const candidateTtfb = await measureTtfb(origin);
    acceptance.candidateTtfb = candidateTtfb.home;
    acceptance.candidateDeferredTtfb = candidateTtfb.deferred;
    acceptance.candidateRss = (await memory()).rss;
    const allowedTtfb = baselineTtfb.home + Math.max(35, baselineTtfb.home * 0.5);

    if (candidateTtfb.home > allowedTtfb) {
      console.warn(`Advisory: production TTFB exceeded ${Math.round(allowedTtfb)}ms; shared-runner timing does not block release.`);
    }
    console.info(
      `production median HTML TTFB: / ${baselineTtfb.home.toFixed(3)}ms -> ${candidateTtfb.home.toFixed(3)}ms; /deferred ${baselineTtfb.deferred.toFixed(3)}ms -> ${candidateTtfb.deferred.toFixed(3)}ms`,
    );
    console.info(`Advisory: streamed shell ratio: ${(candidateTtfb.deferred / candidateTtfb.home).toFixed(3)}x / 1.5x target`);
  } finally {
    await stop(prod);
    await dispose();
  }

  const plain = await startProductionMeasurement({ directory, port: await getPort(), baseline: true });

  try {
    await measureTtfb(plain.origin);
    acceptance.baselineRss = (await plain.memory()).rss;
  } finally {
    await plain.stop();
  }

  acceptance.coldStart = await measureProductionColdStart({ directory, getPort });
  console.info(`production cold start samples (ms): plain ${acceptance.coldStart.baseline.map((value) => value.toFixed(1)).join(', ')}; candidate ${acceptance.coldStart.candidate.map((value) => value.toFixed(1)).join(', ')}`);
  assertProductionBudgets(acceptance);

  await verifyProductionImports();
  await verifyIncrementalServer('start');

  if (keepTemplate) {
    await cp(join(directory, 'build'), join(directory, 'build-ssr'), { recursive: true });
  }

  await configureBasename();
  await run(['build']);
  const basePort = await getPort();
  const baseServer = start(['start', '--port', String(basePort)]);
  try {
    const origin = `http://127.0.0.1:${basePort}`;
    await waitUntilReady(`${origin}/acceptance/`, baseServer);
    await verify(origin, 'production basename', '/acceptance');
  } finally {
    await stop(baseServer);
  }

  if (keepTemplate) {
    await cp(join(directory, 'build'), join(directory, 'build-basename'), { recursive: true });
  }

  // Restore the original configuration before checking the standalone SPA build.
  for (const filename of ['vite.config.ts', 'src/client.ts', 'src/server.ts']) {
    await cp(join(source, filename), join(directory, filename));
  }
  await run(['build', '--focus-only', 'client']);
  const spaPort = await getPort();
  const spa = start(['start', '--focus-only', 'client', '--port', String(spaPort)]);
  try {
    const origin = `http://127.0.0.1:${spaPort}`;
    await waitUntilReady(origin, spa);
    await verifySpa(origin);
  } finally {
    await stop(spa);
  }
  assert.ok(acceptance.policyInfo > 0, 'Incremental SSR must emit policy information with diagnostics enabled.');
  assert.equal(acceptance.diagnosticsWarnings, 0, 'Template emitted unexpected SSR_BOOST_ diagnostics.');
} finally {
  if (keepTemplate) {
    console.info(`Template retained for browser checks: ${directory}`);
  } else if (isAbsolute(directory) && directory.startsWith(tmpdir())) {
    await rm(directory, { force: true, recursive: true });
  }
  await reportAcceptance();
}
