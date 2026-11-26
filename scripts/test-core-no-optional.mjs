import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this proof through npm: npm run test:core:no-optional');
}

const directory = await realpath(await mkdtemp(join(tmpdir(), 'vite-ssr-boost-core-')));
const projectRoot = process.cwd();
const runNpm = (args) =>
  execFileSync(process.execPath, [npmCli, ...args], {
    cwd: directory,
    stdio: 'inherit',
  });

try {
  execFileSync(
    process.execPath,
    [npmCli, 'pack', './lib', '--ignore-scripts', '--pack-destination', directory, '--silent'],
    {
      cwd: projectRoot,
      stdio: 'ignore',
    },
  );
  const archives = (await readdir(directory)).filter((filename) => filename.endsWith('.tgz'));

  if (archives.length !== 1) {
    throw new Error('npm pack did not produce an archive.');
  }

  const [archive] = archives;
  const dependencies = {
    '@lomray/vite-ssr-boost': `file:./${archive}`,
  };
  const addLocalDependency = async (name) => {
    if (dependencies[name]) {
      return;
    }

    const location = join(projectRoot, 'node_modules', ...name.split('/'));
    const metadata = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));

    dependencies[name] = `file:${location}`;

    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      await addLocalDependency(dependency);
    }
  };

  for (const dependency of [
    'chalk',
    'commander',
    'hoist-non-react-statics',
    'json5',
    'react',
    'react-dom',
    'react-router',
  ]) {
    await addLocalDependency(dependency);
  }

  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ dependencies, private: true, type: 'module' }),
  );

  runNpm([
    'install',
    '--prefer-offline',
    '--omit=optional',
    '--legacy-peer-deps',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `./${archive}`,
  ]);

  for (const dependency of ['compression', 'express', 'vite', '@playwright/test']) {
    try {
      await access(join(directory, 'node_modules', dependency));
      throw new Error(`${dependency} was installed despite --omit=optional.`);
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const packageRoot = join(directory, 'node_modules', '@lomray', 'vite-ssr-boost');
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

  // Removed entrypoints must not survive in npm archives as stale build output.
  for (const subpath of [
    'node/entry',
    'node/render',
    'node/server',
    'node/create-fetch-request',
    'node/write-response',
    'services/prepare-server',
    'helpers/handle-response',
    'adapters/express/write-response',
    'adapters/express/handle-response',
  ]) {
    for (const suffix of ['.js', '.d.ts', '.js.map', '.d.ts.map']) {
      await assert.rejects(access(join(packageRoot, subpath + suffix)), { code: 'ENOENT' });
    }
  }

  for (const dependency of ['compression', 'express']) {
    if (packageJson.dependencies?.[dependency]) {
      throw new Error(`${dependency} is still a required runtime dependency.`);
    }
  }

  if (!((await stat(join(packageRoot, 'cli.js'))).mode & 0o111)) {
    throw new Error('The packed CLI is not executable after installation.');
  }

  const assertRuntimeClean = async (relativeDirectory) => {
    const directoryPath = join(packageRoot, relativeDirectory);

    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      const relativePath = join(relativeDirectory, entry.name);

      if (entry.isDirectory()) {
        await assertRuntimeClean(relativePath);
      } else if (entry.name.endsWith('.js')) {
        const code = await readFile(join(packageRoot, relativePath), 'utf8');

        if (/(?:from|import\()\s*["'](?:compression|express)["']/.test(code)) {
          throw new Error(`${relativePath} imports an optional adapter dependency.`);
        }

        if (/(?:from|import\()\s*["']vite(?:\/[^"']*)?["']/.test(code)) {
          throw new Error(`${relativePath} imports Vite at runtime.`);
        }

        if (
          /(?:from|import\()\s*["'](?:node:|fs["']|http["']|https["']|path["']|url["'])/.test(
            code,
          )
        ) {
          throw new Error(`${relativePath} imports a Node runtime module.`);
        }
      }
    }
  };

  await assertRuntimeClean('core');
  await assertRuntimeClean('edge');

  // Exercise the installed package name: file URLs would bypass the exports map.
  const files = (await readdir(packageRoot, { recursive: true }))
    .filter((file) => /\.(?:js|d\.ts|map|json|md)$/.test(file) || /(?:LICENSE|Dockerfile)$/.test(file));
  const resolutions = files.flatMap((file) => [
    [file, pathToFileURL(join(packageRoot, file)).href],
    ...(file.endsWith('.js') ? [[file.slice(0, -3), pathToFileURL(join(packageRoot, file)).href]] : []),
  ]);

  const proof = `
    import assert from 'node:assert/strict';
    for (const [subpath, expected] of ${JSON.stringify(resolutions)}) {
      assert.equal(import.meta.resolve('@lomray/vite-ssr-boost/' + subpath), expected, subpath);
    }
    const { default: createHandler } = await import('@lomray/vite-ssr-boost/core/handler');
    const { createTestHandler, createDeferred, crawlerRequest } = await import('@lomray/vite-ssr-boost/testing');
    const testingJs = await import('@lomray/vite-ssr-boost/testing.js');
    assert.equal(createTestHandler, testingJs.createTestHandler);
    const React = await import('react');
    const deferred = createDeferred();
    const testApp = createTestHandler({
      diagnostics: false,
      routes: [{ id: 'test', path: '/', element: React.createElement('p', null, 'testing-ok'), loader: () => ({ slow: deferred.promise }) }],
    });
    const testResponse = await testApp.fetch(crawlerRequest('/'));
    deferred.resolve(new Set([42n]));
    assert.equal(testResponse.status, 200);
    assert.deepEqual((await testResponse.routerState()).loaderData.test.slow, new Set([42n]));
    assert.match(await testResponse.html(), /testing-ok/);
    const { default: adapterEdge } = await import('@lomray/vite-ssr-boost/adapters/edge');
    const { default: adapterNode } = await import('@lomray/vite-ssr-boost/adapters/node');
    const http = await import('@lomray/vite-ssr-boost/http');
    const httpJs = await import('@lomray/vite-ssr-boost/http.js');
    for (const name of ['cacheControl', 'documentHeaders', 'copyLoaderHeaders', 'conditionalRequest']) {
      assert.equal(typeof http[name], 'function', name);
      assert.equal(http[name], httpJs[name], name);
    }
    assert.equal(http.cacheControl({ private: true, noStore: true }), 'private, no-store');
    const production = await import('@lomray/vite-ssr-boost/node/production');
    const productionJs = await import('@lomray/vite-ssr-boost/node/production.js');
    for (const name of ['loadHtmlShell', 'createRouteAssetPreparer', 'prepareProduction', 'createProductionServer', 'serveStatic', 'createLifecycle']) {
      assert.equal(typeof production[name], 'function', name);
      assert.equal(production[name], productionJs[name], name);
    }
    const dev = await import('@lomray/vite-ssr-boost/node/dev');
    const devJs = await import('@lomray/vite-ssr-boost/node/dev.js');
    for (const name of ['prepareDev', 'createDevServer']) {
      assert.equal(typeof dev[name], 'function', name);
      assert.equal(dev[name], devJs[name], name);
    }
    const { default: defineEntry, isEntry } = await import('@lomray/vite-ssr-boost/core/entry');
    assert.equal(isEntry(defineEntry(() => null, [{ path: '/', element: null }])), true);
    assert.equal(createHandler, (await import('@lomray/vite-ssr-boost/core/handler.js')).default);
    assert.equal(adapterEdge, (await import('@lomray/vite-ssr-boost/adapters/edge.js')).default);
    assert.equal(adapterNode, (await import('@lomray/vite-ssr-boost/adapters/node.js')).default);
    const response = await adapterEdge(async () => new Response('core-ok'))(
      new Request('https://edge.example/')
    );
    if (
      typeof createHandler !== 'function' ||
      typeof adapterNode !== 'function' ||
      await response.text() !== 'core-ok'
    ) {
      throw new Error('Core/edge runtime proof failed.');
    }
  `;

  const runtimeProof = join(directory, 'consumer.mjs');

  await writeFile(runtimeProof, proof);
  execFileSync(process.execPath, [runtimeProof], {
    cwd: directory,
    stdio: 'inherit',
  });

  // A node managed build must serve, and drain on SIGTERM, with neither Express nor Vite installed.
  const buildDir = join(directory, 'build');

  await mkdir(join(buildDir, 'client', 'assets'), { recursive: true });
  await mkdir(join(buildDir, 'server'), { recursive: true });
  await writeFile(
    join(buildDir, 'client', 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"><!--ssr-outlet--></div></body></html>',
  );
  await writeFile(join(buildDir, 'client', 'assets', 'app-AbCdEf12.js'), 'export {};');
  await writeFile(
    join(buildDir, 'server', 'server.js'),
    `import { createElement } from 'react';
    import defineEntry from '@lomray/vite-ssr-boost/core/entry';
    export default defineEntry(({ children }) => children, [
      { path: '/', element: createElement('p', null, 'node-server-ok') },
    ]);`,
  );
  await writeFile(
    join(buildDir, 'server', 'ssr-boost.json'),
    JSON.stringify({
      version: 1,
      root: '..',
      base: '/',
      mode: 'production',
      publicDir: 'client',
      indexFile: 'client/index.html',
      serverFile: 'server/server.js',
      managedServer: 'node',
    }),
  );
  await writeFile(
    join(buildDir, 'server', 'fingerprinted-files.json'),
    JSON.stringify(['assets/app-AbCdEf12.js']),
  );

  const serverProof = join(directory, 'node-server.mjs');

  await writeFile(
    serverProof,
    `
    import assert from 'node:assert/strict';
    import { createProductionServer } from '@lomray/vite-ssr-boost/node/production';
    const app = await createProductionServer({ buildDir: ${JSON.stringify(buildDir)}, compression: true, health: {} });
    const { port } = await app.listen(0, '127.0.0.1');
    const origin = 'http://127.0.0.1:' + port;
    const page = await fetch(origin + '/', { headers: { 'user-agent': 'Googlebot/2.1', 'accept-encoding': 'gzip' } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /node-server-ok/);
    assert.equal(page.headers.get('content-encoding'), 'gzip');
    const asset = await fetch(origin + '/assets/app-AbCdEf12.js');
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const shell = await fetch(origin + '/index.html');
    assert.notEqual(shell.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(origin + '/readyz')).status, 200);
    assert.equal((await fetch(origin + '/missing')).status, 404);
    await app.close();
    await app.close();
    `,
  );
  execFileSync(process.execPath, [serverProof], { cwd: directory, stdio: 'inherit' });

  const port = await new Promise((resolve, reject) => {
    const probe = createNetServer();

    probe.once('error', reject);
    probe.listen(0, () => {
      const { port: free } = probe.address();

      probe.close(() => resolve(free));
    });
  });
  const cli = spawn(
    process.execPath,
    [join(packageRoot, 'cli.js'), 'start', '--build-dir', buildDir, '--port', String(port)],
    { cwd: directory, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const exited = new Promise((resolve) => cli.once('exit', (code, signal) => resolve({ code, signal })));

  try {
    const deadline = Date.now() + 20000;
    let body;

    while (body === undefined) {
      if (Date.now() > deadline || cli.exitCode !== null) {
        throw new Error('ssr-boost start did not serve the node build.');
      }

      body = await fetch(new URL('/', `http://${'127.0.0.1'}:${port}`), {
        headers: { 'user-agent': 'Googlebot/2.1' },
      })
        .then((response) => (response.ok ? response.text() : undefined))
        .catch(() => undefined);

      if (body === undefined) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    assert.match(body, /node-server-ok/);
    cli.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally {
    cli.kill('SIGKILL');
  }

  // Resolve the public conditional export in an installed consumer, with no Node shims.
  const edgeBundle = await build({
    absWorkingDir: directory,
    stdin: {
      contents: "export { createTestHandler, TestResponse } from '@lomray/vite-ssr-boost/testing';",
      resolveDir: directory,
    },
    bundle: true,
    platform: 'browser',
    conditions: ['workerd', 'worker', 'browser'],
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"production"' },
    metafile: true,
    write: false,
  });
  assert.ok(Object.keys(edgeBundle.metafile.inputs).some((file) => file.endsWith('/testing/edge.js')));
  assert.ok(!Object.keys(edgeBundle.metafile.inputs).some((file) => /playwright|\/node\/|express/.test(file)));

  const typeProof = join(directory, 'consumer.mts');

  await writeFile(typeProof, `
    import adapterEdge from '@lomray/vite-ssr-boost/adapters/edge';
    import adapterEdgeJs from '@lomray/vite-ssr-boost/adapters/edge.js';
    import type { TSsrHandler } from '@lomray/vite-ssr-boost/core/types';
    import type { TSsrHandler as TSsrHandlerJs } from '@lomray/vite-ssr-boost/core/types.js';

    import { loadHtmlShell, createRouteAssetPreparer } from '@lomray/vite-ssr-boost/node/production';
    import { loadHtmlShell as loadHtmlShellJs, createRouteAssetPreparer as createRouteAssetPreparerJs } from '@lomray/vite-ssr-boost/node/production.js';
    import type { IHtmlShell, ILoadHtmlShellOptions, IRouteAssetPreparerOptions } from '@lomray/vite-ssr-boost/node/production';
    import type { IHtmlShell as IHtmlShellJs } from '@lomray/vite-ssr-boost/node/production.js';
    import type { ICreateHandlerOptions } from '@lomray/vite-ssr-boost/core/handler';
    import { createProductionServer, prepareProduction } from '@lomray/vite-ssr-boost/node/production';
    import type { IProductionServer, IPrepareProductionOptions } from '@lomray/vite-ssr-boost/node/production';
    import defineEntry from '@lomray/vite-ssr-boost/core/entry';
    import type { IEntry } from '@lomray/vite-ssr-boost/core/entry';
    const productionOptions: IPrepareProductionOptions = { buildDir: '/app/build', static: false };
    const productionServer: Promise<IProductionServer> = createProductionServer({ ...productionOptions, compression: true, drainTimeoutMs: 1000 });
    const prepared: Promise<{ handler: TSsrHandler }> = prepareProduction(productionOptions);
    const typedEntry: IEntry = defineEntry(() => null, [{ path: '/' }]);
    // @ts-expect-error managed compression takes a boolean or options, not a string.
    createProductionServer({ compression: 'gzip' });
    import { cacheControl, documentHeaders, conditionalRequest } from '@lomray/vite-ssr-boost/http';
    import type { IDocumentHeaderRule } from '@lomray/vite-ssr-boost/http.js';
    const rules: IDocumentHeaderRule[] = [{ when: ({ hasCookie }) => !hasCookie('session'), set: { 'Cache-Control': cacheControl({ public: true, sMaxAge: 30 }) } }];
    const headers: Headers = documentHeaders(rules, { sessionCookie: 'session' })({ request: new Request('https://example.com'), response: { headers: new Headers() } });
    const conditional: Response | undefined = conditionalRequest(new Request('https://example.com'), { etag: '"v1"' });
    // @ts-expect-error Cache durations are numeric seconds.
    cacheControl({ maxAge: '30' });
    import { createTestHandler, createDeferred, TestResponse } from '@lomray/vite-ssr-boost/testing';
    const deferred = createDeferred<string[]>();
    deferred.resolve(['ready']);
    // @ts-expect-error Deferred resolution must match its declared value type.
    deferred.resolve(42);
    const testApp = createTestHandler({ routes: [{ path: '/', loader: () => ({ users: deferred.promise }) }] });
    const testResponse: TestResponse = await testApp.fetch('/', { isStream: false, timeout: 100 });
    const html: string = await testResponse.html();

    const shellOptions: ILoadHtmlShellOptions = { indexFile: '/app/build/client/index.html' };
    const assetOptions: IRouteAssetPreparerOptions = { buildDir: '/app/build', modulePreload: true };
    const shell: IHtmlShell = (await loadHtmlShell(shellOptions))();
    const shellJs: IHtmlShellJs = (await loadHtmlShellJs(shellOptions))();
    const prepare: NonNullable<ICreateHandlerOptions<{ app: string }>['prepare']> = createRouteAssetPreparer<{ app: string }>(assetOptions);
    const prepareJs: typeof prepare = createRouteAssetPreparerJs<{ app: string }>(assetOptions);
    // @ts-expect-error The build directory is required.
    createRouteAssetPreparer({});
    // @ts-expect-error The index file must be a string.
    loadHtmlShell({ indexFile: new URL('file:///app/index.html') });

    const handler: TSsrHandler = async (request) => new Response(request.url);
    const handlerJs: TSsrHandlerJs = handler;
    const response: Response = await adapterEdge(handler)(new Request('https://example.com'));
    const responseJs: Response = await adapterEdgeJs(handlerJs)(new Request('https://example.com'));
    // @ts-expect-error A handler must return a Response, not a string.
    const invalid: TSsrHandler = async () => 'invalid';
    // @ts-expect-error The adapter requires a Fetch Request.
    adapterEdge(handler)('https://example.com');
  `);

  for (const [module, moduleResolution] of [
    [ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext],
    [ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler],
  ]) {
    const options = { module, moduleResolution, noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022 };

    for (const file of files.filter((name) => name.endsWith('.d.ts'))) {
      const subpath = file.slice(0, -5);

      for (const suffix of ['', '.js', '.d.ts']) {
        const { resolvedModule } = ts.resolveModuleName(
          `@lomray/vite-ssr-boost/${subpath}${suffix}`, typeProof, options, ts.sys,
        );

        if (resolvedModule?.resolvedFileName !== join(packageRoot, file)) {
          throw new Error(`Declaration resolution failed: ${subpath}${suffix} (${moduleResolution}).`);
        }
      }
    }

    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([typeProof], options));

    if (diagnostics.length) {
      throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n',
      }));
    }
  }

  process.stdout.write('Packed exports (including http, testing, core/entry, node/production and node/dev), the node managed server without Express or Vite, NodeNext/Bundler declarations, optional-free core/testing and edge testing bundle passed.\n');
} finally {
  await rm(directory, { force: true, recursive: true });
}
