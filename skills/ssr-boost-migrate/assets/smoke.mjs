import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createGunzip } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(
  new URL('../node_modules/@lomray/vite-ssr-boost/cli.js', import.meta.url),
);
// Adapted from Lomray-Software/vite-template (MIT), commit 66da771d0e3b092e716378ede0952674448d3dbf.
let buildDir = 'build';
const children = new Set();
let interrupted = false;

// Keep the HTTP and process helpers self-contained, following scripts/test-template.mjs
// in vite-ssr-boost. Count decoded HTML chunks so gzip headers cannot pass the stream check.
const getPort = async () => {
  const server = net.createServer();

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const closed = once(server, 'close');

  server.close();
  await closed;

  return port;
};

const startProcess = (command, args) => {
  assert.ok(!interrupted, 'Smoke check interrupted.');
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', detached: true });
  const processState = { child, result: null, done: null, stopping: null };

  processState.done = new Promise((resolve) => {
    const finish = (result) => {
      processState.result = result;
      resolve(result);
    };

    child.once('error', (error) => finish({ error }));
    child.once('exit', (code, signal) => finish({ code, signal }));
  });
  children.add(processState);

  return processState;
};

const stop = (state) => {
  state.stopping ??= (async () => {
    const signalGroup = (signal) => {
      if (!state.child.pid) {
        return;
      }

      try {
        process.kill(-state.child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') {
          throw error;
        }
      }
    };

    signalGroup('SIGTERM');
    const timeout = setTimeout(() => signalGroup('SIGKILL'), 3_000);

    try {
      await state.done;
    } finally {
      clearTimeout(timeout);
      children.delete(state);
    }
  })();

  return state.stopping;
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    interrupted = true;
    console.error(`[smoke] Interrupted by ${signal}.`);
    await Promise.all([...children].map(stop));
    process.exit(1);
  });
}

const build = async (args = []) => {
  console.info(`[smoke] env -u NO_COLOR npx ssr-boost build ${args.join(' ')}`.trim());
  const state = startProcess('env', ['-u', 'NO_COLOR', 'npx', 'ssr-boost', 'build', ...args]);
  const { code, signal, error } = await state.done;

  if (error) {
    throw error;
  }

  assert.equal(code, 0, `ssr-boost build failed (${signal ?? code}).`);
  children.delete(state);
};

const inspect = (origin, pathname, { method = 'GET', headers = {}, timeout = 30_000 } = {}) =>
  new Promise((resolve, reject) => {
    const request = http.request(
      new URL(pathname, origin),
      { method, headers, signal: AbortSignal.timeout(timeout) },
      (response) => {
        const chunks = [];
        const decoded =
          response.headers['content-encoding'] === 'gzip'
            ? response.pipe(createGunzip())
            : response;

        decoded.on('data', (chunk) => chunks.push(chunk));
        decoded.on('end', () => {
          resolve({
            status: response.statusCode,
            html: Buffer.concat(chunks).toString('utf8'),
            chunks: chunks.length,
          });
        });
        response.on('error', reject);
        decoded.on('error', reject);
      },
    );

    request.on('error', (error) => reject(new Error(`${method} ${pathname}: ${error.message}`)));
    request.end();
  });

const waitUntilReady = async (origin, state) => {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    assert.ok(!interrupted, 'Smoke check interrupted.');
    assert.ok(
      !state.result,
      `Server exited before readiness (${state.result?.error?.message ?? state.result?.signal ?? state.result?.code}).`,
    );

    try {
      await inspect(origin, '/', { timeout: 1_000 });

      return;
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Server did not become ready within 30 seconds: ${origin}`);
};

const withServer = async (mode, args, verify) => {
  const port = await getPort();
  const origin = `http://127.0.0.1:${port}`;
  const state = startProcess(process.execPath, [cli, 'start', '--build-dir', buildDir, ...args, '--port', String(port)]);

  console.info(`[smoke] Starting ${mode} server on port ${port} (PID ${state.child.pid}).`);

  try {
    await waitUntilReady(origin, state);
    await verify(origin);
  } finally {
    await stop(state);
    console.info(`[smoke] Stopped ${mode} server (PID ${state.child.pid}).`);
  }
};

try {
  const config = JSON.parse(
    await readFile(new URL('./smoke.config.json', import.meta.url), 'utf8'),
  );
  const { routes, streamPath, crawlerCookie, crawlerRoutes } = config;
  buildDir = config.buildDir ?? 'build';

  assert.ok(Array.isArray(routes) && routes.length > 0, 'Configure at least one smoke route.');
  assert.ok(typeof streamPath === 'string' && streamPath.startsWith('/'), 'Configure streamPath.');
  assert.ok(
    typeof crawlerCookie === 'string' && crawlerCookie.length > 0,
    'Configure crawlerCookie.',
  );

  await build();
  await withServer('SSR', [], async (origin) => {
    for (const { path, status, contains = [], containsAny = [], headers = {} } of routes) {
      const response = await inspect(origin, path, { headers });

      assert.equal(response.status, status, `SSR GET ${path}: expected status ${status}.`);
      for (const marker of contains) {
        assert.ok(
          response.html.includes(marker),
          `SSR GET ${path}: missing ${JSON.stringify(marker)}.`,
        );
      }

      if (containsAny.length > 0) {
        assert.ok(
          containsAny.some((marker) => response.html.includes(marker)),
          `SSR GET ${path}: expected one of ${JSON.stringify(containsAny)}.`,
        );
      }

      console.info(`[smoke] SSR GET ${path}: ${status}; content checks passed.`);
    }

    const first = routes[0];
    const head = await inspect(origin, first.path, { method: 'HEAD', headers: first.headers });

    assert.equal(head.status, first.status, `SSR HEAD ${first.path}: unexpected status.`);
    assert.equal(head.html, '', `SSR HEAD ${first.path}: expected an empty body.`);
    console.info(`[smoke] SSR HEAD ${first.path}: ${head.status}; empty body.`);

    const streamed = await inspect(origin, streamPath);

    assert.equal(streamed.status, 200, `SSR stream ${streamPath}: expected status 200.`);
    assert.ok(
      streamed.chunks > 1,
      `SSR stream ${streamPath}: expected more than one HTML chunk, got ${streamed.chunks}.`,
    );
    console.info(`[smoke] SSR stream ${streamPath}: ${streamed.chunks} HTML chunks.`);

    const crawler = await inspect(origin, streamPath, { headers: { Cookie: crawlerCookie } });

    assert.equal(crawler.status, 200, `SSR crawler ${streamPath}: expected status 200.`);
    assert.ok(
      !crawler.html.includes('<!--$?-->'),
      `SSR crawler ${streamPath}: pending Suspense boundary.`,
    );
    console.info(`[smoke] SSR crawler ${streamPath}: 200; no pending Suspense boundaries.`);

    for (const { path, contains } of crawlerRoutes) {
      const response = await inspect(origin, path, { headers: { 'User-Agent': 'Googlebot' } });

      assert.equal(response.status, 200, `SSR Googlebot ${path}: expected status 200.`);
      for (const marker of contains) {
        assert.ok(response.html.includes(marker), `SSR Googlebot ${path}: missing ${marker}.`);
      }
      assert.ok(
        !response.html.includes('<!--$?-->'),
        `SSR Googlebot ${path}: pending Suspense boundary.`,
      );
      console.info(`[smoke] SSR Googlebot ${path}: 200; resolved users; no pending boundaries.`);
    }
  });

  await build(['--focus-only', 'client']);
  await withServer('SPA', ['--focus-only', 'client'], async (origin) => {
    for (const path of ['/', streamPath, '/deferred']) {
      const response = await inspect(origin, path);

      assert.equal(response.status, 200, `SPA GET ${path}: expected status 200.`);
      assert.ok(
        !response.html.includes('window.__staticRouterHydrationData'),
        `SPA GET ${path}: unexpected hydration data.`,
      );
      console.info(`[smoke] SPA GET ${path}: 200; no hydration data.`);
    }
  });

  console.info('[smoke] All checks passed.');
} catch (error) {
  console.error(`[smoke] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all([...children].map(stop));
}
