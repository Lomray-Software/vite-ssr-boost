import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createGunzip } from 'node:zlib';
import { stripVTControlCharacters } from 'node:util';
import { parse } from '@babel/parser';

const projectRoot = process.cwd();
const source = resolve(process.argv[2] ?? join(projectRoot, '..', 'vite-template'));
const directory = await mkdtemp(join(tmpdir(), 'vite-ssr-boost-template-'));
const keepTemplate = process.env.SSR_BOOST_KEEP_TEMPLATE === '1';
const useCurrentDependencies = process.env.SSR_BOOST_TEMPLATE_CURRENT === '1';
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

const run = async (args) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    env: { ...process.env, PATH: runtimePath },
    stdio: 'inherit',
  });
  const [code] = await once(child, 'exit');

  if (code !== 0) {
    throw new Error(`ssr-boost ${args[0]} exited with code ${code}.`);
  }
};

const start = (args) =>
  spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    env: { ...process.env, PATH: runtimePath },
    stdio: 'inherit',
  });

const hasExited = (child) => child.exitCode !== null || child.signalCode !== null;

const stop = async (child) => {
  if (hasExited(child)) {
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
      let firstChunkMs;
      // Count HTML bytes, not the empty gzip header that can hide buffering regressions.
      const decoded =
        response.headers['content-encoding'] === 'gzip' ? response.pipe(createGunzip()) : response;

      decoded.on('data', (chunk) => {
        firstChunkMs ??= performance.now() - started;
        chunks.push(chunk);
      });
      decoded.on('end', () => {
        resolveStream({
          chunks: chunks.length,
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

const measureTtfb = async (origin) => {
  await inspectStream(origin, '/');
  await inspectStream(origin, '/');

  const samples = [];

  for (let sample = 0; sample < 7; sample += 1) {
    samples.push((await inspectStream(origin, '/')).firstChunkMs);
  }

  samples.sort((left, right) => left - right);

  return samples[Math.floor(samples.length / 2)];
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

  if (mode !== 'development') {
    const compressed = await inspectEarlyStream(origin, `${base}/details`, `${mode} gzip`, {
      'Accept-Encoding': 'gzip',
    });
    assert.equal(compressed.encoding, 'gzip');
    assert.match(compressed.html, /<\/html>/);
    console.info(
      `${mode}: gzip HTML shell ${Math.round(compressed.firstChunkMs)}ms / complete ${Math.round(compressed.totalMs)}ms`,
    );
  }

  console.info(
    `${mode}: routes passed; streamed=${streamed.chunks} chunks (${Math.round(
      streamed.firstChunkMs,
    )}ms/${Math.round(streamed.totalMs)}ms); buffered=${buffered.chunks} chunks`,
  );
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
    assert.doesNotMatch(html, /window\.__staticRouterHydrationData|Welcome to demo app/);
    const entry = html.match(/<script[^>]+src="([^"]+)"/);
    assert.ok(entry, `SPA ${pathname} has no client entry`);
    const script = await fetch(new URL(entry[1], origin));
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    await script.arrayBuffer();
  }
  console.info('SPA: root, deep links, fallback and client assets passed');
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
    'init: async () => {',
    "routerOptions: { basename: '/acceptance' }, init: async () => {",
  );
  await edit(
    'src/server.ts',
    'abortDelay: 20000,',
    "abortDelay: 20000, routerOptions: { basename: '/acceptance' }, middlewares: { expressStatic: { basename: '/acceptance' } },",
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
  const current = 'SPA, SSR, Mobx, Consistent Suspense, Meta tags';
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

  await cp(join(source, 'node_modules'), join(directory, 'node_modules'), { recursive: true });

  await run(['build']);

  const baselinePort = await getPort();
  const baseline = start(['start', '--port', String(baselinePort)]);
  let baselineTtfb;

  try {
    const origin = `http://127.0.0.1:${baselinePort}`;

    await waitUntilReady(origin, baseline);
    baselineTtfb = await measureTtfb(origin);
    console.info(`baseline production median TTFB: ${Math.round(baselineTtfb)}ms`);
  } finally {
    await stop(baseline);
  }

  await installCandidate();
  await configureTypedRoutes();

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

  await run(['build']);

  const prodPort = await getPort();
  const prod = start(['start', '--port', String(prodPort)]);

  try {
    const origin = `http://127.0.0.1:${prodPort}`;

    await waitUntilReady(origin, prod);
    await verify(origin, 'production');

    const candidateTtfb = await measureTtfb(origin);
    const allowedTtfb = baselineTtfb + Math.max(35, baselineTtfb * 0.5);

    if (candidateTtfb > allowedTtfb) {
      console.warn(`Advisory: production TTFB exceeded ${Math.round(allowedTtfb)}ms; shared-runner timing does not block release.`);
    }
    console.info(
      `production median TTFB: ${Math.round(baselineTtfb)}ms -> ${Math.round(candidateTtfb)}ms`,
    );
  } finally {
    await stop(prod);
  }

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
} finally {
  if (keepTemplate) {
    console.info(`Template retained for browser checks: ${directory}`);
  } else if (isAbsolute(directory) && directory.startsWith(tmpdir())) {
    await rm(directory, { force: true, recursive: true });
  }
}
