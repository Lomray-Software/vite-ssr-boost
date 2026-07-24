import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const projectRoot = process.cwd();
const source = resolve(process.argv[2] ?? join(projectRoot, '..', 'vite-template'));
const directory = await mkdtemp(join(tmpdir(), 'vite-ssr-boost-template-'));
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
      await fetch(origin);

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

      response.on('data', (chunk) => {
        firstChunkMs ??= performance.now() - started;
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolveStream({
          chunks: chunks.length,
          firstChunkMs,
          html: Buffer.concat(chunks).toString('utf8'),
          status: response.statusCode,
          totalMs: performance.now() - started,
        });
      });
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

const verify = async (origin, mode) => {
  const cases = [
    ['/', 200],
    ['/not-lazy', 200],
    ['/redirect-demo', 301],
    ['/missing', 404],
    ['/vite.svg', 200],
  ];

  for (const [pathname, expectedStatus] of cases) {
    const response = await fetch(new URL(pathname, origin), { redirect: 'manual' });

    assert.equal(response.status, expectedStatus, `${mode} ${pathname}`);
  }

  const streamed = await inspectStream(origin, '/details');

  assert.equal(streamed.status, 200, `${mode} streamed status`);
  assert.ok(streamed.chunks > 1, `${mode} did not stream multiple chunks`);
  assert.ok(streamed.firstChunkMs < streamed.totalMs, `${mode} shell was not streamed early`);
  assert.match(streamed.html, /window\.__staticRouterHydrationData/);
  assert.match(streamed.html, /<\/html>/);

  const buffered = await inspectStream(origin, '/details', { Cookie: 'isCrawler=1' });

  assert.equal(buffered.status, 200, `${mode} buffered status`);
  assert.match(buffered.html, /window\.__staticRouterHydrationData/);
  assert.match(buffered.html, /<\/html>/);

  console.info(
    `${mode}: routes passed; streamed=${streamed.chunks} chunks (${Math.round(
      streamed.firstChunkMs,
    )}ms/${Math.round(streamed.totalMs)}ms); buffered=${buffered.chunks} chunks`,
  );
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

  await rm(join(directory, 'node_modules', '@lomray', 'vite-ssr-boost'), {
    force: true,
    recursive: true,
  });
  await cp(join(projectRoot, 'lib'), join(directory, 'node_modules', '@lomray', 'vite-ssr-boost'), {
    recursive: true,
  });

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

  await run(['build']);

  const prodPort = await getPort();
  const prod = start(['start', '--port', String(prodPort)]);

  try {
    const origin = `http://127.0.0.1:${prodPort}`;

    await waitUntilReady(origin, prod);
    await verify(origin, 'production');

    const candidateTtfb = await measureTtfb(origin);
    const allowedTtfb = baselineTtfb + Math.max(35, baselineTtfb * 0.5);

    assert.ok(
      candidateTtfb <= allowedTtfb,
      `Production TTFB regressed: ${Math.round(baselineTtfb)}ms -> ${Math.round(
        candidateTtfb,
      )}ms (allowed ${Math.round(allowedTtfb)}ms).`,
    );
    console.info(
      `production median TTFB: ${Math.round(baselineTtfb)}ms -> ${Math.round(
        candidateTtfb,
      )}ms`,
    );
  } finally {
    await stop(prod);
  }
} finally {
  if (isAbsolute(directory) && directory.startsWith(tmpdir())) {
    await rm(directory, { force: true, recursive: true });
  }
}
